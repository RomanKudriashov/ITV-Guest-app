import { expect, test } from './fixtures'

import { API, DEMO_ROOM, HOTEL } from './helpers'

/**
 * СРОК НЕ СЕГОДНЯ — С ДАТОЙ И ПО ЧАСАМ ОТЕЛЯ (партия 30, п.46).
 *
 * Страница заказа показывала срок только часами и в поясе БРАУЗЕРА. Гость с
 * телефоном на дубайском времени видел московский заказ сдвинутым на час, а
 * срок на завтра читался как сегодняшний. Условие явное: браузер — Asia/Dubai,
 * заказ «к часу, который у отеля уже прошёл» — значит, на завтра.
 */

test('заказ на завтра: на странице заказа дата и время отеля, а не браузера', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const hotelNow = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
  const [hh] = hotelNow.split(':').map(Number)
  const clock = `${String((hh + 23) % 24).padStart(2, '0')}:00` // час назад по отелю → завтра

  const context = await browser.newContext({ timezoneId: 'Asia/Dubai', locale: 'ru-RU' })
  const page = await context.newPage()
  let auth = ''
  page.on('request', (r) => {
    const value = r.headers()['authorization']
    if (value && r.url().includes('/api/')) auth = value
  })
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => auth).not.toBe('')
  const guest = { Authorization: auth, 'X-Hotel-Subdomain': HOTEL }
  const catalog = JSON.stringify(await (await request.get(`${API}/api/guest/catalog`, { headers: guest })).json())
  const caesar = /"id":\s*"([0-9a-f-]{36})"[^{}]*"code":\s*"caesar"/.exec(catalog)?.[1]
  const created = await request.post(`${API}/api/guest/order`, {
    data: { lines: [{ item_id: caesar, quantity: 1 }], timing: 'scheduled', requested_clock: clock },
    headers: { ...guest, 'Idempotency-Key': `e2e-due-${Date.now()}` },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const order = await created.json()

  try {
    await page.goto(`/orders/${order.id}`)
    const facts = page.getByTestId('guest-order-facts')
    await expect(facts).toBeVisible({ timeout: 20_000 })
    const text = await facts.innerText()
    expect(text, 'срок — время отеля, а не браузера').toContain(clock)
    expect(text, 'срок на завтра — с датой').toMatch(/(пн|вт|ср|чт|пт|сб|вс)[^\n]*\d{1,2}[^\n]*,\s*\d{2}:\d{2}/i)
  } finally {
    await context.close()
    await request.post(`${API}/api/guest/order/${order.id}/cancel`, { data: { reason: '' }, headers: guest })
  }
})
