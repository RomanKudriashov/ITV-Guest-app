import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { ADMIN, API, apiHeaders, apiToken, DEMO_ROOM } from './helpers'

/**
 * КОРЗИНА ПЕРЕСТАЁТ ВРАТЬ О ПОЗИЦИЯХ.
 *
 * Строка корзины — снимок на момент добавления. Мир меняется, снимок нет: блюдо
 * уходит в стоп-лист, дорожает, снимается с витрины — а в корзине всё как было.
 * Раньше было и хуже: одна недоступная позиция роняла ВЕСЬ расчёт, и гость видел
 * ошибку вместо корзины.
 *
 * Три укуса: снять с витрины → помечено, оформить нельзя; поднять цену → видно
 * старую и новую; послать заказ мимо интерфейса → сервер отказывает.
 */

const PHONE = { width: 390, height: 844 }
/** Блюдо без модификаторов: кладётся прямым нажатием, без шторки. */
const ITEM = 'carbonara'

test.use({ viewport: PHONE })

async function enterAndAdd(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
  await page.locator('[data-testid^="guest-home-tile-"]').first().click()
  await expect(page.getByTestId(`guest-qty-plus-${ITEM}`)).toBeVisible({ timeout: 20_000 })
  await page.getByTestId(`guest-qty-plus-${ITEM}`).click()
}

async function openCart(page: Page): Promise<void> {
  await page.getByTestId('guest-cart-button').click()
  await expect(page.getByTestId('guest-cart')).toBeVisible({ timeout: 15_000 })
}

/** id и цена блюда — правим их через CMS, как это делает отель. */
async function itemState(request: APIRequestContext, token: string) {
  const page = await request
    .get(`${API}/api/cms/items?search=${ITEM}`, { headers: apiHeaders(token) })
    .then((r) => r.json())
  const found = (page.items ?? page).find((entry: { code: string }) => entry.code === ITEM)
  expect(found, `позиция ${ITEM} не найдена в CMS`).toBeTruthy()
  return found as { id: string; price: number; is_active: boolean }
}

test.describe('Корзина говорит правду', () => {
  test.slow()

  test('снять с витрины → помечено, оформить нельзя', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)
    const item = await itemState(request, token)

    await enterAndAdd(page)
    try {
      // Снимаем с витрины уже ПОСЛЕ того, как гость положил блюдо.
      const off = await request.patch(`${API}/api/cms/items/${item.id}`, {
        data: { is_active: false },
        headers: apiHeaders(token),
      })
      expect(off.ok(), await off.text()).toBeTruthy()

      await openCart(page)

      // Помечено, и сказано ЧТО ДЕЛАТЬ.
      await expect(page.getByTestId(`guest-cart-unavailable-${ITEM}`)).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.getByTestId(`guest-cart-drop-${ITEM}`)).toBeVisible()

      // И оформить нельзя.
      await expect(page.getByTestId('guest-place-order')).toBeDisabled()

      // Убрали — кнопка снова живая.
      await page.getByTestId(`guest-cart-drop-${ITEM}`).click()
      await expect(page.getByTestId(`guest-cart-unavailable-${ITEM}`)).toHaveCount(0)
    } finally {
      await request.patch(`${API}/api/cms/items/${item.id}`, {
        data: { is_active: true },
        headers: apiHeaders(token),
      })
    }
  })

  test('поднять цену → видно старую и новую', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)
    const item = await itemState(request, token)

    await enterAndAdd(page)
    try {
      const raised = await request.patch(`${API}/api/cms/items/${item.id}`, {
        data: { price: item.price + 50_000 },
        headers: apiHeaders(token),
      })
      expect(raised.ok(), await raised.text()).toBeTruthy()

      await openCart(page)
      const warning = page.getByTestId(`guest-cart-price-changed-${ITEM}`)
      await expect(warning).toBeVisible({ timeout: 20_000 })
      // «Было» и «стало» — оба числа, а не одно новое молча.
      await expect(warning).toContainText(/было|was/i)

      // Оформление при этом НЕ заперто: цена изменилась, но заказать можно.
      await expect(page.getByTestId('guest-place-order')).toBeEnabled()
    } finally {
      await request.patch(`${API}/api/cms/items/${item.id}`, {
        data: { price: item.price },
        headers: apiHeaders(token),
      })
    }
  })

  test('мимо интерфейса → сервер отказывает', async ({ request }) => {
    /*
      Экран запирает кнопку, но запрос можно послать и мимо экрана. Здесь
      проверяется именно рубеж: решает сервер, а не вёрстка.
    */
    const token = await apiToken(request, ADMIN)
    const item = await itemState(request, token)

    const guest = await request
      .post(`${API}/api/v1/guest/session`, {
        data: { room_number: DEMO_ROOM },
        headers: { 'X-Hotel-Subdomain': 'crystal' },
      })
      .then((r) => r.json())

    try {
      await request.patch(`${API}/api/cms/items/${item.id}`, {
        data: { is_active: false },
        headers: apiHeaders(token),
      })

      const refused = await request.post(`${API}/api/v1/guest/order`, {
        data: { lines: [{ item_id: item.id, quantity: 1 }], timing: 'asap', comment: '' },
        headers: {
          Authorization: `Bearer ${guest.token}`,
          'X-Hotel-Subdomain': 'crystal',
          'Idempotency-Key': `bypass-${Date.now()}`,
        },
      })
      expect(refused.status(), await refused.text()).toBe(422)
      expect((await refused.json()).code).toBe('item_unavailable')
    } finally {
      await request.patch(`${API}/api/cms/items/${item.id}`, {
        data: { is_active: true },
        headers: apiHeaders(token),
      })
    }
  })
})
