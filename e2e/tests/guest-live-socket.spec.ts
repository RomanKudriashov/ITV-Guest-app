import { type WebSocket as PwSocket } from '@playwright/test'
import { expect, test } from './fixtures'

import { apiToken, DEMO_ROOM, moveOrderStatus, openCart, openVenueFromHome } from './helpers'

/**
 * ЖИВОЙ СТАТУС У ГОСТЯ ИДЁТ ПО СОКЕТУ, И КОНСОЛЬ ЧИСТА (E2E-003).
 *
 * Внешний аудит увидел в консоли «WebSocket is closed before the connection
 * is established» и решил, что статус живёт на опросе. Разведка: на стенде
 * сокет подключается; предупреждение давала наша уборка — `close()` на сокете,
 * который ещё не открылся (быстрый уход с экрана, двойной эффект в режиме
 * разработки). Здесь проверяем оба утверждения фактом:
 *   • сокет заказа открыт и ПРИНЁС смену статуса — кадром, а не опросом;
 *   • предупреждения в консоли нет, даже в режиме разработки.
 */

test('сокет заказа приносит смену статуса, консоль без «closed before…»', async ({ page, request }) => {
  const warnings: string[] = []
  page.on('console', (message) => {
    if (/closed before the connection is established/i.test(message.text())) warnings.push(message.text())
  })
  const frames: string[] = []
  page.on('websocket', (ws: PwSocket) => {
    if (!ws.url().includes('/ws/v1/guest/order/')) return
    ws.on('framereceived', (frame) => frames.push(String(frame.payload)))
  })

  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })
  await openVenueFromHome(page)
  await page.getByTestId('guest-qty-plus-caesar').click()
  await openCart(page)
  await page.getByTestId('guest-place-order').click()
  await expect(page.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
  const orderId = page.url().split('/orders/')[1]?.split('?')[0] as string
  await page.getByTestId('guest-track-order').click()

  // Снимок при подключении — сокет открыт и говорит.
  await expect.poll(() => frames.some((f) => f.includes('"connected"')), { timeout: 15_000 }).toBeTruthy()

  const staff = await apiToken(request)
  await moveOrderStatus(request, staff, orderId, 'preparing')
  // Смена статуса пришла КАДРОМ сокета — опрос раз в 45 с её бы не успел.
  await expect
    .poll(() => frames.some((f) => f.includes('"order.snapshot"') && f.includes('"preparing"')), {
      timeout: 10_000,
    })
    .toBeTruthy()

  // Уход и возврат — тот самый быстрый размонтаж, что шумел.
  await page.goBack()
  await page.goForward()
  await page.waitForTimeout(1500)
  expect(warnings).toEqual([])
  await moveOrderStatus(request, staff, orderId, 'done')
})
