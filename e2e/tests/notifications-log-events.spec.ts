import { expect, test } from './fixtures'

import { ADMIN, API, DEMO_ROOM, HOTEL, signInToCms } from './helpers'

/**
 * ЖУРНАЛ ПОКАЗЫВАЕТ ВСЕ ОТПРАВКИ, НЕ ТОЛЬКО ЭСКАЛАЦИЮ (партия 31, INV-06 QA).
 *
 * QA отменял заявки гостем (#517, #520) и не находил отправки
 * `order.cancelled` в журнале. Факт: события писались всегда — в свою
 * таблицу, — а журнал читал только ступени эскалации.
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

test('гость отменил заказ — отправка «заказ отменён» видна в журнале', async ({ page, request }) => {
  const guest = (
    await (await request.post(`${API}/api/guest/session`, { data: { room_number: DEMO_ROOM }, headers: { 'X-Hotel-Subdomain': HOTEL } })).json()
  ).token
  const headers = { Authorization: `Bearer ${guest}`, 'X-Hotel-Subdomain': HOTEL }
  const caesar = findByCode(await (await request.get(`${API}/api/guest/catalog`, { headers })).json(), 'caesar')!
  const order = await (
    await request.post(`${API}/api/guest/order`, {
      data: { lines: [{ item_id: caesar.id, quantity: 1 }] },
      headers: { ...headers, 'Idempotency-Key': `inv06-${Date.now()}` },
    })
  ).json()
  const cancelled = await request.post(`${API}/api/guest/order/${order.id}/cancel`, { headers, data: {} })
  expect(cancelled.ok(), await cancelled.text()).toBeTruthy()

  await signInToCms(page, ADMIN)
  await page.goto('/cms/notifications')
  await page.getByTestId('cms-notifications-tab-log').click()
  await page.getByTestId('cms-log-order-filter').fill(String(order.number))
  await expect(page.getByTestId('cms-notification-log')).toContainText(/Событие: .*отмен/i, { timeout: 20_000 })
})

test('подпись ступеней называет базу отсчёта как есть (п.12)', async ({ page }) => {
  // Сервер считает от позднейшего: создание, время гостя, возврат в работу
  // (`work_clock_start`). Подпись обещала «от создания» — QA видел у #521
  // ступень от времени гостя и счёл это расхождением.
  await signInToCms(page, ADMIN)
  await page.goto('/cms/notifications')
  await page.getByTestId('cms-notifications-tab-escalation').click()
  await page.getByTestId('cms-escalation-new').click()
  await expect(page.getByText(/если гость назвал время — от этого времени/)).toBeVisible({ timeout: 20_000 })
})
