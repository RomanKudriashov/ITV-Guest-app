import { expect, test, type APIRequestContext } from '@playwright/test'

import { API, apiToken, guestSession, HOTEL } from './helpers'

/**
 * Финальный сценарий коммерции: включаем сбор/минимум/чаевые в CMS →
 * заказ ниже минимума блокируется с «добавьте ещё N» → добор снимает блок →
 * выбор чаевых → оформление → суммы построчно совпадают с /cart/quote,
 * serve_by показан → аналитика отражает разложение заказа.
 *
 * Настройки коммерции задаём через CMS API (это и есть «в CMS»), а весь
 * потребительский сценарий проверяем в реальном UI витрины. Стенд общий и
 * последовательный (workers:1) — поэтому в finally возвращаем коммерцию в
 * выключенное состояние, чтобы не сломать остальные сценарии.
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

  try {
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
    await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('guest-qty-plus-caesar').click()
    await page.getByTestId('guest-cart-bar').click()
    await expect(page.getByTestId('guest-cart')).toBeVisible()

    // 1×Цезарь (550) ниже минимума (600): блок + подсказка «добавьте ещё».
    await expect(page.getByTestId('guest-cart-below-minimum')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('guest-place-order')).toBeDisabled()

    // --- Добор снимает блок --------------------------------------------------
    await page.getByTestId('guest-qty-plus-caesar').click() // теперь 2×Цезаря = 1100
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
  } finally {
    // Возвращаем коммерцию в выключенное состояние — стенд общий.
    await cmsPatch(request, staff, '/commerce-settings', {
      service_fee_bp: 0,
      tax_bp: 0,
      tip_presets: [],
    })
    await cmsPatch(request, staff, `/categories/${salads.id}`, { min_order_minor: null })
    await cmsPatch(request, staff, `/items/${caesar.id}`, { prep_minutes: null })
  }
})
