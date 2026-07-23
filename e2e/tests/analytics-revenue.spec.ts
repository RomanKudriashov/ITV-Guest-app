import { expect, test } from '@playwright/test'

import { API, apiToken, HOTEL, guestSession, login } from './helpers'

/**
 * После шага 7 revenue_minor — только позиции, полная сумма — gross_minor.
 * Заглавная карточка «Выручка» обязана показывать gross, иначе дашборд молча
 * занижает выручку. Тест пинит именно это, чтобы drift не вернулся.
 */
test('дашборд: заглавная «Выручка» — это gross, а не только позиции', async ({ page, request }) => {
  // Гость оформляет заказ с чаевыми → gross > позиции (у заказа появляется tip).
  const token = await guestSession(request)
  const menu = await request.get(`${API}/api/v1/guest/catalog?type=product`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
  })
  const items = (await menu.json()).categories.flatMap((c: { items: { id: string; code: string }[] }) => c.items)
  const caesar = items.find((i: { code: string }) => i.code === 'caesar')
  const placed = await request.post(`${API}/api/v1/guest/order`, {
    data: { lines: [{ item_id: caesar.id, quantity: 1 }], tip_minor: 100000 },
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Hotel-Subdomain': HOTEL,
      'Idempotency-Key': `e2e-gross-${Date.now()}`,
    },
  })
  expect(placed.ok(), await placed.text()).toBeTruthy()

  // Дашборд: chef — старший кухни; заказ caesar на кухне попадает в его скоуп.
  await login(page)
  await page.getByTestId('cms-analytics-nav').click()
  await expect(page.getByTestId('cms-analytics')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('analytics-filter-preset-today').click()
  await expect(page.getByTestId('analytics-summary')).toBeVisible({ timeout: 15_000 })

  // Значение gross для того же периода — из API тем же токеном.
  const staff = await apiToken(request)
  const summary = await request.get(`${API}/api/v1/cms/analytics/summary?preset=today`, {
    headers: { Authorization: `Bearer ${staff}`, 'X-Hotel-Subdomain': HOTEL },
  })
  const current = (await summary.json()).current
  expect(current.tip_minor).toBeGreaterThan(0)
  // gross строго больше выручки-по-позициям, раз есть чаевые.
  expect(current.gross_minor).toBeGreaterThan(current.revenue_minor)

  // Заглавная цифра карточки «Выручка» = gross (в мажорных единицах), НЕ позиции.
  const headline = page.getByTestId('analytics-summary-value-revenue')
  const digits = (await headline.innerText()).replace(/[^\d]/g, '')
  expect(digits).toBe(String(Math.round(current.gross_minor / 100)))
  expect(digits).not.toBe(String(Math.round(current.revenue_minor / 100)))

  // Разложение показано вторично.
  await expect(page.getByTestId('analytics-revenue-breakdown')).toBeVisible()
})
