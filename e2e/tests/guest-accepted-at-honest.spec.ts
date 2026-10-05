import { expect, test } from './fixtures'

import { API, DEMO_ROOM, apiHeaders, apiToken, signIn } from './helpers'

/**
 * «КОГДА ПРИНЯЛИ» — МОМЕНТ ПРИНЯТИЯ, А НЕ СОЗДАНИЯ (партия 31, QP04-Q01 QA).
 * И подпись у заявки в трекере — по смыслу: номер гостя, а не «Куда».
 */

const CONCIERGE = { email: 'concierge@crystal.local', password: 'chef12345' }

test('заявка: «отправили» сразу, «приняли» — только после принятия; в трекере «Номер гостя»', async ({ page, request }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
  await page.goto('/venue/concierge')
  await page.getByTestId('guest-service-laundry-service').click()
  await page.getByTestId('guest-field-when').fill('12:00')
  await page.getByTestId('guest-request-submit').click()
  await expect(page.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
  const orderId = page.url().match(/orders\/([0-9a-f-]{36})/)![1]

  const facts = page.getByTestId('guest-order-facts')
  await expect(facts).toContainText('Когда отправили')
  await expect(facts).not.toContainText('Когда приняли')

  const concierge = await apiToken(request, CONCIERGE)
  const accepted = await request.post(`${API}/api/tracker/order/${orderId}/accept`, { headers: apiHeaders(concierge), data: {} })
  expect(accepted.ok(), await accepted.text()).toBeTruthy()
  const acceptedAt = new Date((await accepted.json()).accepted_at)
  await page.reload()
  const clock = acceptedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
  await expect(facts).toContainText('Когда приняли', { timeout: 20_000 })
  await expect(facts).toContainText(clock)

  await signIn(page, CONCIERGE)
  await page.goto(`/tracker/order/${orderId}`)
  await expect(page.getByText('Номер гостя')).toBeVisible({ timeout: 20_000 })
})
