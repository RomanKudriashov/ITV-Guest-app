import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, CREDENTIALS, DEMO_ROOM, HOTEL, signIn } from './helpers'

/**
 * ЖИВЫЕ КАНАЛЫ ЗАКАЗА, ЧАТА И ДОСКИ ОТКРЫВАЮТСЯ ОДИН РАЗ (партия 37, п.63).
 *
 * Тот же дефект, что номер в п.53: эффект создавал сокет синхронно, StrictMode
 * в разработке снимает и повторяет эффект — первый сокет успевал уйти на
 * сервер. Замер партии 37: двоился ЧАТ гостя (2 соединения); доска и заказ —
 * по одному и до правки (их сокет включается по данным, после монтирования).
 * Чат лечится как номер — первое подключение следующим тиком; доска и заказ
 * здесь как сторож, чтобы двойное подключение не появилось. Считаем
 * соединения за первые секунды, как `room-socket-once.spec.ts`.
 */

const WINDOW_MS = 4_000

function countSockets(page: Page, part: string): string[] {
  const sockets: string[] = []
  page.on('websocket', (socket) => {
    if (socket.url().includes(part)) sockets.push(socket.url().replace(/token=[^&]+/, 'token=…'))
  })
  return sockets
}

async function enterRoom(page: Page): Promise<string> {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
  return (await page.evaluate(() => window.localStorage.getItem('itv.guest.token'))) as string
}

test('доска трекера: живой канал открывается один раз', async ({ page }) => {
  await signIn(page, CREDENTIALS)
  const sockets = countSockets(page, '/tracker/')
  await page.goto('/tracker')
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(WINDOW_MS)
  expect(sockets, 'сокеты доски за вход').toHaveLength(1)
})

test('чат гостя: живой канал открывается один раз', async ({ page }) => {
  await enterRoom(page)
  const sockets = countSockets(page, '/chat')
  await page.goto('/chat')
  await expect(page.getByTestId('guest-chat').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(WINDOW_MS)
  expect(sockets, 'сокеты чата за вход').toHaveLength(1)
})

test('статус заказа: живой канал открывается один раз', async ({ page }) => {
  const token = await enterRoom(page)
  const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }
  const catalog = JSON.stringify(await (await page.request.get(`${API}/api/guest/catalog`, { headers })).json())
  const caesar = /"code":\s*"caesar"[^}]*?"id":\s*"([^"]+)"|"id":\s*"([^"]+)"[^{}]*?"code":\s*"caesar"/.exec(catalog)
  const itemId = caesar?.[1] ?? caesar?.[2]
  expect(itemId, 'в каталоге нет «Цезаря»').toBeTruthy()
  const created = await page.request.post(`${API}/api/guest/order`, {
    data: { lines: [{ item_id: itemId, quantity: 1 }] },
    headers: { ...headers, 'Idempotency-Key': `socket-once-${Date.now()}` },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const order = await created.json()
  try {
    const sockets = countSockets(page, `/order/${order.id}`)
    await page.goto(`/orders/${order.id}`)
    await expect(page.getByTestId('guest-order-status')).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(WINDOW_MS)
    expect(sockets, 'сокеты заказа за вход').toHaveLength(1)
  } finally {
    // Заказ — остаток проверки: гость отменяет его, пока он «Новый».
    await page.request.post(`${API}/api/guest/order/${order.id}/cancel`, { headers, data: {} })
  }
})
