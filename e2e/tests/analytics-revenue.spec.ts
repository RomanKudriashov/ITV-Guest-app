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

  // Дашборд смотрим админом отеля: с R3 аналитика — не работа линейного повара,
  // и скоуп у админа общеотельный, как и у токена ниже.
  await login(page)
  await page.getByTestId('cms-nav-analytics').click()
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
  // Сравниваем ЧИСЛА, а не строки цифр: формат показывает копейки, когда они
  // есть, и «30 951,04» против «30951» разошлось бы на пустом месте.
  const headline = page.getByTestId('analytics-summary-value-revenue')
  const shown = Number(
    (await headline.innerText())
      .replace(/[^\d,.-]/g, '')
      .replace(/\s/g, '')
      .replace(',', '.'),
  )
  expect(shown).toBeCloseTo(current.gross_minor / 100, 1)
  expect(shown).not.toBeCloseTo(current.revenue_minor / 100, 1)

  // Разложение показано вторично.
  await expect(page.getByTestId('analytics-revenue-breakdown')).toBeVisible()
})
