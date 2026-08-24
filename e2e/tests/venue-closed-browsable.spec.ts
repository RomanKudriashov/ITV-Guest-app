import { expect, test, type APIRequestContext } from '@playwright/test'

import { ADMIN, API, apiHeaders, apiToken, DEMO_ROOM } from './helpers'

/**
 * ЗАКРЫТОЕ ЗАВЕДЕНИЕ ОТКРЫВАЕТСЯ ДЛЯ ПРОСМОТРА.
 *
 * Гость не мог зайти в закрытый ресторан и не видел ни меню, ни цен, ни фото.
 * Карточка недоступной позиции не открывалась вовсе (`disabled` на всей
 * строке), а закрытое заведение объясняло себя мелкой пилюлей поверх кадра.
 *
 * Смотреть можно всё — нельзя ЗАКАЗАТЬ. Это разные запреты, и живут они в
 * разных местах: первого больше нет, второй остался и на экране, и на сервере.
 *
 * Часы правим ЧЕРЕЗ CMS, как это делает отель, и возвращаем в `finally`: стенд
 * общий, и оставленная закрытой кухня уронит соседние наборы.
 */

interface Closed {
  scheduleId: string
  restore: () => Promise<void>
}

/** Закрыть кухню «сейчас»: окно на два часа вперёд по времени ОТЕЛЯ. */
async function closeKitchen(request: APIRequestContext, token: string): Promise<Closed> {
  const services = await request
    .get(`${API}/api/v1/cms/services`, { headers: apiHeaders(token) })
    .then((r) => r.json())
  const kitchen = services.items.find((s: { code: string }) => s.code === 'kitchen')
  expect(kitchen, 'заведение kitchen не найдено').toBeTruthy()
  const was: string | null = kitchen.schedule_id ?? null

  const bootstrap = await request
    .get(`${API}/api/v1/cms/bootstrap`, { headers: apiHeaders(token) })
    .then((r) => r.json())
  const zone: string = bootstrap.hotel?.timezone ?? 'Europe/Moscow'
  const hotelNow = new Date(new Date().toLocaleString('en-US', { timeZone: zone }))
  const from = (hotelNow.getHours() + 2) % 24
  const pad = (n: number) => String(n).padStart(2, '0')

  const created = await request.post(`${API}/api/cms/schedules`, {
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
  expect(created.ok(), await created.text()).toBeTruthy()
  const scheduleId = (await created.json()).id

  await request.patch(`${API}/api/v1/cms/services/${kitchen.id}`, {
    data: { schedule_id: scheduleId },
    headers: apiHeaders(token),
  })

  return {
    scheduleId,
    restore: async () => {
      await request.patch(`${API}/api/v1/cms/services/${kitchen.id}`, {
        data: { schedule_id: was },
        headers: apiHeaders(token),
      })
    },
  }
}

test.describe('Закрытое заведение: смотреть можно', () => {
  test.slow()

  test('УКУС: меню видно, кнопок заказа нет, время открытия названо', async ({
    page,
    request,
  }) => {
    const token = await apiToken(request, ADMIN)
    const closed = await closeKitchen(request, token)

    try {
      await page.goto('/')
      await page.evaluate(() => window.localStorage.clear())
      await page.goto('/')
      await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
      await page.getByTestId('guest-room-submit').click()
      await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })

      // 1. ПЛИТКА ОТКРЫВАЕТСЯ, а не гаснет.
      await page.getByTestId('guest-home-tile-kitchen').click()
      await expect(page.getByTestId('guest-venue')).toBeVisible({ timeout: 20_000 })

      // 2. Шапка говорит прямо: закрыто, когда откроется, и что смотреть можно.
      const banner = page.getByTestId('guest-venue-closed')
      await expect(banner).toBeVisible()
      await expect(banner).toContainText(/смотреть/i)
      await expect(banner).toContainText(/\d{1,2}:\d{2}/)

      // 3. Меню на месте: категории, названия, ЦЕНЫ.
      await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 20_000 })
      const dish = page.getByTestId('guest-item-caesar')
      await expect(dish).toBeVisible()
      await expect(dish).toContainText(/₽|руб/i)

      // 4. Кнопки заказа НЕТ ни у одной позиции.
      await expect(page.getByTestId('guest-qty-plus-caesar')).toHaveCount(0)

      // 5. Строка называет причину заведением, а не блюдом.
      await expect(dish).toContainText(/Откроется в \d{1,2}:\d{2}/)

      // 6. КАРТОЧКА ОТКРЫВАЕТСЯ — ради этого всё и делалось.
      await dish.click()
      const sheet = page.getByTestId('guest-item-unavailable')
      await expect(sheet).toBeVisible({ timeout: 15_000 })
      await expect(sheet).toContainText(/Откроется в \d{1,2}:\d{2}/)
      // Погашенной кнопки с ценой, которую жмут и трясут телефон, больше нет.
      await expect(page.getByTestId('guest-add-to-cart')).toHaveCount(0)
    } finally {
      await closed.restore()
    }
  })

  test('УКУС: мимо интерфейса сервер по-прежнему отказывает', async ({ request }) => {
    /*
      Второй рубеж не тронут. Послабление на экране обязано остаться
      послаблением ЭКРАНА: заказ, отправленный запросом, отбивается сервером.
    */
    const token = await apiToken(request, ADMIN)
    const closed = await closeKitchen(request, token)

    try {
      const menu = await request
        .get(`${API}/api/v1/cms/items?limit=200`, { headers: apiHeaders(token) })
        .then((r) => r.json())
      const item = menu.items.find((i: { code: string }) => i.code === 'caesar')
      expect(item, 'позиция caesar не найдена').toBeTruthy()

      const guest = await request
        .post(`${API}/api/v1/guest/session`, {
          data: { room_number: DEMO_ROOM },
          headers: { 'X-Hotel-Subdomain': 'crystal' },
        })
        .then((r) => r.json())
      const headers = { Authorization: `Bearer ${guest.token}`, 'X-Hotel-Subdomain': 'crystal' }

      const refused = await request.post(`${API}/api/v1/guest/order`, {
        data: { lines: [{ item_id: item.id, quantity: 1 }], timing: 'asap', comment: '' },
        headers: { ...headers, 'Idempotency-Key': `browse-${Date.now()}` },
      })
      expect(refused.status(), await refused.text()).toBe(422)
      expect((await refused.json()).code).toBe('item_unavailable')
    } finally {
      await closed.restore()
    }
  })
})
