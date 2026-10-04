import { expect, test } from './fixtures'

import { ADMIN, API, DEMO_ROOM, HOTEL, apiHeaders, apiToken, signIn } from './helpers'

/**
 * УДАЛЁННЫЙ СОТРУДНИК В ИСТОРИИ ЗАКАЗА — НЕ «ГОСТЬ» (партия 31, DEV-02 QA).
 *
 * QA: сотрудник принял заказ, его штатно удалили — после перезагрузки автор
 * события стал «гостем». Временный повар заводится и удаляется здесь же;
 * заказ остаётся как след (история, как у QA, не стирается).
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

test('сотрудник принял заказ и удалён — в истории его имя с пометкой, не «гость»', async ({ page, request }) => {
  const admin = await apiToken(request, ADMIN)
  const stamp = Date.now().toString(36)
  const name = `Повар ${stamp}`
  const email = `cook-${stamp}@crystal.local`
  const password = 'cook-pass-12345'
  const points = (await (await request.get(`${API}/api/cms/bootstrap`, { headers: apiHeaders(admin) })).json())
    .execution_points as Array<{ id: string; code: string }>
  const kitchen = points.find((p) => p.code === 'kitchen')!
  const created = await request.post(`${API}/api/cms/staff`, {
    headers: apiHeaders(admin),
    data: { email, full_name: name, password, assignments: [{ execution_point_id: kitchen.id, level: 'member' }] },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const cookId = (await created.json()).id

  // Заказ гостя и принятие временным поваром.
  const guest = (
    await (
      await request.post(`${API}/api/guest/session`, { data: { room_number: DEMO_ROOM }, headers: { 'X-Hotel-Subdomain': HOTEL } })
    ).json()
  ).token
  const gh = { Authorization: `Bearer ${guest}`, 'X-Hotel-Subdomain': HOTEL }
  const caesar = findByCode(await (await request.get(`${API}/api/guest/catalog`, { headers: gh })).json(), 'caesar')!
  const order = await (
    await request.post(`${API}/api/guest/order`, {
      data: { lines: [{ item_id: caesar.id, quantity: 1 }] },
      headers: { ...gh, 'Idempotency-Key': `e2e-dev02-${stamp}` },
    })
  ).json()
  const cook = await apiToken(request, { email, password })
  const accepted = await request.post(`${API}/api/tracker/order/${order.id}/accept`, { headers: apiHeaders(cook), data: {} })
  expect(accepted.ok(), await accepted.text()).toBeTruthy()

  const removed = await request.delete(`${API}/api/cms/staff/${cookId}`, { headers: apiHeaders(admin) })
  expect(removed.ok(), await removed.text()).toBeTruthy()

  await signIn(page, ADMIN)
  await page.goto(`/tracker/order/${order.id}`)
  const journal = page.getByTestId('tracker-order-journal')
  await expect(journal).toBeVisible({ timeout: 20_000 })
  await expect(journal).toContainText(`${name} (удалён)`)
  const acceptedEntry = journal.getByRole('listitem').filter({ hasText: name })
  await expect(acceptedEntry).not.toContainText('гость')
})
