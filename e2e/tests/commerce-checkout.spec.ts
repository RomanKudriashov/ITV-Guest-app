import { expect, test, type APIRequestContext } from '@playwright/test'

import { API, apiToken, guestSession, HOTEL, openCart } from './helpers'

/**
 * Финальный сценарий коммерции: включаем сбор/минимум/чаевые в CMS →
 * заказ ниже минимума блокируется с «добавьте ещё N» → добор снимает блок →
 * выбор чаевых → оформление → суммы построчно совпадают с /cart/quote,
 * serve_by показан → аналитика отражает разложение заказа.
 *
 * Настройки коммерции задаём через CMS API (это и есть «в CMS»), а весь
 * потребительский сценарий проверяем в реальном UI витрины. Стенд общий и
 * последовательный (workers:1), поэтому коммерцию обязательно возвращаем в
 * выключенное состояние.
 *
 * Уборка живёт в afterEach, а НЕ в finally внутри теста: при таймауте
 * Playwright бросает тело теста, зависший await никогда не завершается — и
 * finally не выполняется. Один упавший по таймауту прогон оставлял минимум
 * заказа на общем стенде и ронял полтора десятка чужих сценариев, у которых
 * кнопка «оформить» молча оказывалась заблокированной. Хук отрабатывает в
 * любом исходе.
 */

const CAESAR = 55000 // цена «Цезаря» в сидовом меню, копейки
const MIN_ORDER = 60000 // порог: 1×Цезарь ниже, 2×Цезаря выше

async function cmsPatch(request: APIRequestContext, token: string, path: string, data: unknown) {
  const resp = await request.patch(`${API}/api/cms${path}`, {
    data,
    headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
  })
  expect(resp.ok(), `${path}: ${await resp.text()}`).toBeTruthy()
  return resp.json()
}

async function cmsGet(request: APIRequestContext, token: string, path: string) {
  const resp = await request.get(`${API}/api/cms${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
  })
  expect(resp.ok(), `${path}: ${await resp.text()}`).toBeTruthy()
  return resp.json()
}

/**
 * Возврат стенда в исходное состояние. Идёт хуком, а не концом теста: тест мог
 * не дойти до конца вовсе (упасть, повиснуть, быть убитым), а следующие
 * сценарии заказывают из тех же салатов.
 */
test.afterEach(async ({ request }) => {
  const staff = await apiToken(request)
  await cmsPatch(request, staff, '/commerce-settings', {
    service_fee_bp: 0,
    tax_bp: 0,
    tip_presets: [],
  })
  const tree = await cmsGet(request, staff, '/categories')
  const salads = tree.find((n: { code: string }) => n.code === 'salads')
  if (salads) await cmsPatch(request, staff, `/categories/${salads.id}`, { min_order_minor: null })
  const items = await cmsGet(request, staff, `/items?category_id=${salads.id}`)
  const caesar = items.find((i: { code: string }) => i.code === 'caesar')
  if (caesar) await cmsPatch(request, staff, `/items/${caesar.id}`, { prep_minutes: null })
})

test('витрина: минимум блокирует, чаевые и суммы из quote, serve_by, аналитика', async ({
  page,
  request,
}) => {
  const staff = await apiToken(request)

  const tree = await cmsGet(request, staff, '/categories')
  const salads = tree.find((n: { code: string }) => n.code === 'salads')
  expect(salads, 'категория salads').toBeTruthy()
  const items = await cmsGet(request, staff, `/items?category_id=${salads.id}`)
  const caesar = items.find((i: { code: string }) => i.code === 'caesar')
  expect(caesar, 'позиция caesar').toBeTruthy()
  void CAESAR

  // --- Настройка коммерции «в CMS» ----------------------------------------
  await cmsPatch(request, staff, '/commerce-settings', {
    service_fee_bp: 1000, // 10% сервисный сбор
    tax_bp: 0,
    tip_presets: [5, 10, 15],
  })
  await cmsPatch(request, staff, `/categories/${salads.id}`, { min_order_minor: MIN_ORDER })
  await cmsPatch(request, staff, `/items/${caesar.id}`, { prep_minutes: 15 })

  // --- Гость: ниже минимума → блок ----------------------------------------
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill('305')
  await page.getByTestId('guest-room-submit').click()
    await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })
  // К блюдам гость идёт ЧЕРЕЗ заведение: плоского меню отеля больше нет,
  // и путь теста совпадает с путём живого гостя — плитка на главной.
  await page.getByTestId('guest-home-tile-kitchen').click()
  await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 15_000 })

  await page.getByTestId('guest-qty-plus-caesar').click()
  await openCart(page)

  // 1×Цезарь (550) ниже минимума (600): блок + подсказка «добавьте ещё».
  await expect(page.getByTestId('guest-cart-below-minimum')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('guest-place-order')).toBeDisabled()

  // --- Добор снимает блок --------------------------------------------------
  // На десктопе каталог и колонка корзины видны одновременно — добираем из
  // самой корзины (на мобиле это единственный видимый степпер).
  await page
    .getByTestId('guest-cart-line-caesar')
    .getByTestId('guest-qty-plus-caesar')
    .click() // теперь 2×Цезаря = 1100
  await expect(page.getByTestId('guest-cart-below-minimum')).toHaveCount(0)

  // --- Чаевые: пресет 10% --------------------------------------------------
  await page.getByTestId('guest-tip-preset-10').click()
  // Сервисный сбор виден строкой (10% включён).
  await expect(page.getByTestId('guest-cart-charge-fee')).toBeVisible()

  // --- Итог витрины = /cart/quote (клиент ничего не считает сам) -----------
  // Эталон — тем же контрактом /cart/quote (расчёт stateless, годится любая
  // валидная сессия отеля): 2×Цезаря + 10% чаевых.
  const guestToken = await guestSession(request)
  const quote = await (
    await request.post(`${API}/api/v1/guest/cart/quote`, {
      data: { lines: [{ item_id: caesar.id, quantity: 2 }], tip_percent: 10 },
      headers: { Authorization: `Bearer ${guestToken}`, 'X-Hotel-Subdomain': HOTEL },
    })
  ).json()
  expect(quote.service_fee_minor).toBeGreaterThan(0)
  expect(quote.tip_minor).toBeGreaterThan(0)
  const totalDigits = (await page.getByTestId('guest-cart-total').innerText()).replace(/[^\d]/g, '')
  expect(totalDigits).toBe(String(Math.round(quote.total_minor / 100)))

  // --- Оформление ----------------------------------------------------------
  await page.getByTestId('guest-place-order').click()
  await expect(page.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
  const orderId = page.url().split('/orders/')[1]?.split('?')[0]
  expect(orderId).toBeTruthy()

  // serve_by показан (у позиции есть prep_minutes).
  await expect(page.getByTestId('guest-serve-by').first()).toBeVisible({ timeout: 10_000 })

  // Снимок заказа построчно совпадает с quote (читаем токеном ТОЙ ЖЕ сессии,
  // что оформляла — заказы скоупятся по сессии гостя).
  const uiToken = await page.evaluate(() => window.localStorage.getItem('itv.guest.token'))
  const order = await (
    await request.get(`${API}/api/v1/guest/order/${orderId}`, {
      headers: { Authorization: `Bearer ${uiToken}`, 'X-Hotel-Subdomain': HOTEL },
    })
  ).json()
  expect(order.charges.subtotal_minor).toBe(quote.subtotal_minor)
  expect(order.charges.service_fee_minor).toBe(quote.service_fee_minor)
  expect(order.charges.delivery_fee_minor).toBe(quote.delivery_fee_minor)
  expect(order.charges.tip_minor).toBe(quote.tip_minor)
  expect(order.charges.total_minor).toBe(quote.total_minor)
  expect(order.serve_by).toBeTruthy()

  // --- Аналитика отражает разложение заказа -------------------------------
  const summary = await (
    await request.get(`${API}/api/v1/cms/analytics/summary?preset=today`, {
      headers: { Authorization: `Bearer ${staff}`, 'X-Hotel-Subdomain': HOTEL },
    })
  ).json()
  expect(summary.current.service_fee_minor).toBeGreaterThan(0)
  expect(summary.current.tip_minor).toBeGreaterThan(0)
  expect(summary.current.gross_minor).toBeGreaterThan(summary.current.revenue_minor)
})
