import { expect, test } from './fixtures'
import { guestPage } from './brandGuest'

/**
 * НА ВХОДЕ В НОМЕР ОТКРЫВАЕТСЯ ОДИН СОКЕТ (партия 30, п.53 бэклога).
 *
 * Замер партии 25: на `/room` первый сокет открывался на ~880 мс, второй — на
 * ~1120 мс, и первый закрывался. Гостю не видно, серверу — лишнее соединение
 * на каждый вход. Причина (партия 30): эффект создавал сокет синхронно, а
 * StrictMode снимает и повторяет эффект — первый сокет успевал уйти на
 * сервер. Без StrictMode — один. Считаем сокеты номера за первые секунды.
 */

test('вход в номер: живой канал открывается один раз', async ({ browser }) => {
  const page = await guestPage(browser)
  const sockets: string[] = []
  page.on('websocket', (socket) => {
    if (socket.url().includes('/guest/room/')) sockets.push(socket.url().replace(/token=[^&]+/, 'token=…'))
  })
  await page.goto('/room')
  await expect(page.getByTestId('room-page').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(4_000)
  expect(sockets, 'сокеты номера за вход').toHaveLength(1)
  await page.context().close()
})
