import { type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, CREDENTIALS, DEMO_ROOM, HOTEL, apiToken, signInToTracker } from './helpers'

/**
 * ОТМЕНА ИЗ ТРЕКЕРА С ПРИЧИНОЙ ДОХОДИТ ДО СЕРВЕРА (партия 31, DEV-01 QA).
 *
 * Трекер слал `{"reason": "…"}`, сервер требует КОД `cancel_reason` — 422
 * `cancel_reason_required`, заказ оставался в работе. Ни одна проверка не
 * отменяла заказ из трекера, поэтому расхождение прожило до внешнего QA.
 * Теперь: причина выбирается из справочника (без неё кнопка не жмётся),
 * уточнение — по желанию; тело сверяет ещё и сторож контракта (fixtures.ts).
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

async function placeOrder(request: APIRequestContext): Promise<{ id: string; number: number }> {
  const guestToken = (
    await (
      await request.post(`${API}/api/guest/session`, {
        data: { room_number: DEMO_ROOM },
        headers: { 'X-Hotel-Subdomain': HOTEL },
      })
    ).json()
  ).token
  const headers = { Authorization: `Bearer ${guestToken}`, 'X-Hotel-Subdomain': HOTEL }
  const catalog = await (await request.get(`${API}/api/guest/catalog`, { headers })).json()
  const caesar = findByCode(catalog, 'caesar')
  expect(caesar, 'в каталоге нет «Цезаря»').toBeTruthy()
  const created = await request.post(`${API}/api/guest/order`, {
    data: { lines: [{ item_id: (caesar as { id: string }).id, quantity: 1 }] },
    headers: { ...headers, 'Idempotency-Key': `e2e-cancel-${Date.now()}` },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  return created.json()
}

test('трекер: отмена с причиной из справочника — заказ отменён, причина сохранена', async ({ page, request }) => {
  const order = await placeOrder(request)
  await signInToTracker(page, CREDENTIALS)

  await page.getByTestId(`tracker-more-${order.number}`).click({ timeout: 20_000 })
  await page.getByTestId(`tracker-cancel-${order.number}`).click()
  const confirm = page.getByTestId('tracker-cancel-confirm')
  await expect(confirm, 'без причины отменить нельзя').toBeDisabled()

  await page.getByTestId('tracker-cancel-reason-code').click()
  await page.getByTestId('tracker-cancel-reason-out_of_stock').click()
  await page.getByTestId('tracker-cancel-reason').fill('закончилась курица')
  const sent = page.waitForResponse((r) => r.url().includes(`/tracker/order/${order.id}/cancel`))
  await confirm.click()
  const response = await sent
  expect(response.status(), await response.text()).toBe(200)

  const token = await apiToken(request, CREDENTIALS)
  const after = await (
    await request.get(`${API}/api/tracker/order/${order.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
  ).json()
  expect(after.status.is_cancelled).toBe(true)
  expect(after.cancel_reason).toBe('out_of_stock')
})
