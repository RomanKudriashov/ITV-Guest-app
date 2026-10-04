import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, CREDENTIALS, DEMO_ROOM, HOTEL, apiHeaders, apiToken, moveOrderStatus } from './helpers'

/**
 * ПЛАШКА ГОСТЯ ГОВОРИТ ПРАВДУ О СТАДИИ (партия 31, DEV-06 QA).
 *
 * «Заявка принята / уже передали исполнителю» висела, пока в адресе
 * `?placed=1`: у новой, у отменённой и у выполненной (#521, #522 у QA).
 * Теперь: новая — «отправлена»; принятая — «приняли»; выполнена или
 * отменена — плашки нет.
 */

function findByCode(node: unknown, code: string): { id: string } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByCode(child, code)
      if (found) return found
    }
    return null
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>
    if (record.code === code && typeof record.id === 'string') return { id: record.id }
    for (const value of Object.values(record)) {
      const found = findByCode(value, code)
      if (found) return found
    }
  }
  return null
}

async function guestOrder(page: Page, key: string): Promise<{ id: string; token: string }> {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
  const token = (await page.evaluate(() => window.localStorage.getItem('itv.guest.token'))) as string
  const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }
  const catalog = await (await page.request.get(`${API}/api/guest/catalog`, { headers })).json()
  const caesar = findByCode(catalog, 'caesar')!
  const created = await page.request.post(`${API}/api/guest/order`, {
    data: { lines: [{ item_id: caesar.id, quantity: 1 }] },
    headers: { ...headers, 'Idempotency-Key': `${key}-${Date.now()}` },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  return { id: (await created.json()).id, token }
}

test('новая → «отправлена», принятая → «приняли», выполненная — без плашки', async ({ page, request }) => {
  test.setTimeout(120_000)
  const order = await guestOrder(page, 'dev06-a')
  await page.goto(`/orders/${order.id}?placed=1`)
  const title = page.getByTestId('guest-confirmation-title')
  await expect(title).toHaveText(/Заявка отправлена/, { timeout: 20_000 })
  await expect(page.getByTestId('guest-confirmation')).not.toContainText(/передали|приняли/)

  const chef = await apiToken(request, CREDENTIALS)
  const accepted = await request.post(`${API}/api/tracker/order/${order.id}/accept`, { headers: apiHeaders(chef), data: {} })
  expect(accepted.ok(), await accepted.text()).toBeTruthy()
  await page.reload()
  await expect(title).toHaveText(/Заявка принята/, { timeout: 20_000 })
  await expect(page.getByTestId('guest-confirmation')).toContainText(/приняли/)

  await moveOrderStatus(request, await apiToken(request, ADMIN), order.id, 'done')
  await page.reload()
  await expect(page.getByTestId('guest-order-status')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('guest-confirmation')).toHaveCount(0)
})

test('отменённая гостем — плашки «принята» нет', async ({ page }) => {
  const order = await guestOrder(page, 'dev06-b')
  const cancelled = await page.request.post(`${API}/api/guest/order/${order.id}/cancel`, {
    headers: { Authorization: `Bearer ${order.token}`, 'X-Hotel-Subdomain': HOTEL },
    data: {},
  })
  expect(cancelled.ok(), await cancelled.text()).toBeTruthy()
  await page.goto(`/orders/${order.id}?placed=1`)
  await expect(page.getByTestId('guest-order-status')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('guest-confirmation')).toHaveCount(0)
})
