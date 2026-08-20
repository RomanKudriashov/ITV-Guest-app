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

/**
 * ЗАКРЫТОЕ ЗАВЕДЕНИЕ БЛОКИРУЕТ ЗАКАЗ.
 *
 * Часы заведения не входили в цепочку доступности вовсе: гость видел «Открыто
 * до 23:00» в шапке и спокойно заказывал в полночь. Теперь заведение — звено
 * цепи, и закрытие гасит все его блюда.
 *
 * Правим часы ЧЕРЕЗ CMS, как это делает отель, и возвращаем их в `finally`:
 * стенд общий, и оставлять кухню закрытой значит уронить соседние наборы.
 */
test.describe('Закрытое заведение', () => {
  test.slow()

  test('заведение закрыто → отказ и на экране, и на рубеже', async ({ request }) => {
    const token = await apiToken(request, ADMIN)
    const item = await itemState(request, token)

    const services = await request
      .get(`${API}/api/v1/cms/services`, { headers: apiHeaders(token) })
      .then((r) => r.json())
    const kitchen = services.items.find((s: { code: string }) => s.code === 'kitchen')
    expect(kitchen, 'заведение kitchen не найдено').toBeTruthy()
    const wasSchedule: string | null = kitchen.schedule_id ?? null

    /*
      «Закрыто сейчас» вместо «закрыто всегда»: расписание без интервалов
      сервер справедливо не принимает — пустое расписание это не режим работы,
      а недозаполненная форма.

      Окно считаем от ВРЕМЕНИ ОТЕЛЯ, а не машины: доступность живёт в его
      таймзоне, и окно «через два часа» по московскому времени может оказаться
      текущим часом где-нибудь ещё. Два часа вперёд — заведомо не сейчас.
    */
    const bootstrap = await request
      .get(`${API}/api/v1/cms/bootstrap`, { headers: apiHeaders(token) })
      .then((r) => r.json())
    const zone: string = bootstrap.hotel?.timezone ?? 'Europe/Moscow'
    const hotelNow = new Date(new Date().toLocaleString('en-US', { timeZone: zone }))
    const from = (hotelNow.getHours() + 2) % 24
    const pad = (n: number) => String(n).padStart(2, '0')
    const closed = await request.post(`${API}/api/cms/schedules`, {
      data: {
        name: `Закрыто сейчас ${Date.now()}`,
        is_always_open: false,
        intervals: [...Array(7).keys()].map((weekday) => ({
          weekday,
          start_time: `${pad(from)}:00`,
          end_time: `${pad((from + 1) % 24)}:00`,
        })),
      },
      headers: apiHeaders(token),
    })
    expect(closed.ok(), await closed.text()).toBeTruthy()
    const closedId = (await closed.json()).id

    const guest = await request
      .post(`${API}/api/v1/guest/session`, {
        data: { room_number: DEMO_ROOM },
        headers: { 'X-Hotel-Subdomain': 'crystal' },
      })
      .then((r) => r.json())
    const guestHeaders = {
      Authorization: `Bearer ${guest.token}`,
      'X-Hotel-Subdomain': 'crystal',
    }

    try {
      await request.patch(`${API}/api/v1/cms/services/${kitchen.id}`, {
        data: { schedule_id: closedId },
        headers: apiHeaders(token),
      })

      // 1. Котировка ПОМЕЧАЕТ строку и называет причину.
      const quote = await request
        .post(`${API}/api/v1/guest/cart/quote`, {
          data: { lines: [{ item_id: item.id, quantity: 1 }], timing: 'asap' },
          headers: guestHeaders,
        })
        .then((r) => r.json())
      const line = quote.lines[0]
      expect(line.is_available).toBe(false)
      expect(line.unavailable_reason).toBe('venue_closed')
      expect(quote.has_unavailable).toBe(true)

      // 2. Оформление ОТБИТО — даже мимо интерфейса.
      const refused = await request.post(`${API}/api/v1/guest/order`, {
        data: { lines: [{ item_id: item.id, quantity: 1 }], timing: 'asap', comment: '' },
        headers: { ...guestHeaders, 'Idempotency-Key': `closed-${Date.now()}` },
      })
      expect(refused.status(), await refused.text()).toBe(422)
      expect((await refused.json()).code).toBe('item_unavailable')
    } finally {
      await request.patch(`${API}/api/v1/cms/services/${kitchen.id}`, {
        data: { schedule_id: wasSchedule },
        headers: apiHeaders(token),
      })
    }
  })
})
