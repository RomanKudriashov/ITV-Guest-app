import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken, signInToCms } from './helpers'

/**
 * Заведение без каталога (пункт 10): у ресепшена нет меню, доставки,
 * коммерции и включений — только часы, персонал и настройки. У кухни всё
 * на месте. Раздел в ресепшен сервер не заводит и мимо экрана.
 */
test('ресепшен — отдел без меню, кухня — с меню', async ({ page, request }) => {
  const token = await apiToken(request)
  const services = await (
    await request.get(`${API}/api/cms/services?limit=100`, { headers: apiHeaders(token) })
  ).json()
  const list = services.items ?? services
  const reception = list.find((s: { code: string }) => s.code === 'reception')
  const kitchen = list.find((s: { code: string }) => s.code === 'kitchen')
  expect(reception.has_catalog).toBe(false)
  expect(kitchen.has_catalog).toBe(true)

  await signInToCms(page, ADMIN)
  await page.goto('/cms/services')
  await expect(page.getByTestId('service-no-catalog-reception')).toBeVisible({ timeout: 20_000 })

  await page.goto(`/cms/services/${reception.id}`)
  await expect(page.getByTestId('cms-service-workspace')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('service-no-catalog-hint')).toBeVisible()
  for (const tab of ['menu', 'delivery', 'commerce', 'inclusions']) {
    await expect(page.getByTestId(`service-tab-${tab}`)).toHaveCount(0)
  }
  await expect(page.getByTestId('service-tab-schedule')).toBeVisible()
  await expect(page.getByTestId('service-schedule')).toBeVisible()
  await expect(page.getByTestId('service-has-catalog')).not.toBeChecked()

  await page.goto(`/cms/services/${kitchen.id}`)
  await expect(page.getByTestId('service-tab-menu')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('service-no-catalog')).toHaveCount(0)

  const refused = await request.post(`${API}/api/cms/categories`, {
    data: { title: { ru: 'Меню ресепшена' }, service_id: reception.id },
    headers: apiHeaders(token),
  })
  expect(refused.status()).toBe(422)
  expect((await refused.json()).code).toBe('service_without_catalog')
})
