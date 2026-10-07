import { expect, test } from './fixtures'

import { ADMIN, API, DEMO_ROOM, HOTEL, apiToken } from './helpers'

/**
 * ГЛАВНАЯ НЕ ПИШЕТ «НЕДОСТУПНО» В НОМЕРЕ БЕЗ УПРАВЛЕНИЯ (партия 25).
 *
 * У отеля с включённым управлением номером главная каждого номера БЕЗ типа
 * управления показывала «Состояние номера недоступно, обратитесь на
 * ресепшен» — хотя ничего не сломано: управлять там нечем. Такой номер теперь
 * `unmanaged`, и блок на главной не показывается. В номере с управлением
 * блок на месте.
 *
 * Условие явное: номер без типа заводится для проверки и удаляется.
 */

test('номер без типа управления: блока состояния на главной нет; с типом — есть', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const headers = { Authorization: `Bearer ${await apiToken(request, ADMIN)}`, 'X-Hotel-Subdomain': HOTEL }
  const number = `9${Date.now() % 100000}`
  const made = await request.post(`${API}/api/cms/rooms`, { headers, data: { number, floor: '9' } })
  expect(made.ok(), await made.text()).toBeTruthy()
  const roomId = (await made.json()).id

  try {
    for (const [room, expected] of [
      [number, 0],
      [DEMO_ROOM, 1],
    ] as const) {
      const context = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'ru-RU' })
      const page = await context.newPage()
      await page.goto('/')
      await page.getByTestId('guest-room-input').fill(room)
      await page.getByTestId('guest-room-submit').click()
      await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
      // Снимок состояния приходит не сразу: ждём его ответа, потом судим.
      await page.waitForResponse((r) => r.url().includes('/guest/room/state'), { timeout: 20_000 }).catch(() => null)
      await page.waitForTimeout(1_000)
      await expect(
        page.getByTestId('guest-home-room-status'),
        expected ? 'в номере с управлением блок пропал' : `номер ${room} без управления: на главной «недоступно»`,
      ).toHaveCount(expected)
      await context.close()
    }
  } finally {
    await request.delete(`${API}/api/cms/rooms/${roomId}`, { headers })
  }
})
