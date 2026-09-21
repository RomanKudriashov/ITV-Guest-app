import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken, signIn } from './helpers'

/**
 * ВКЛАДКА «ПЕРСОНАЛ» У ЗАВЕДЕНИЯ — список людей, а не число со ссылкой
 * (пункт 8 разбора).
 *
 * Было: «сотрудников: 4» и кнопка «в раздел персонала». Управляющий открывал
 * карточку своего заведения с вопросом «кто у меня работает и кто старший», а
 * получал предложение поискать самому в общем списке отеля.
 */
test('вкладка «Персонал» показывает людей с ролями', async ({ page, request }) => {
  const token = await apiToken(request)
  const services = await (
    await request.get(`${API}/api/cms/services`, { headers: apiHeaders(token) })
  ).json()
  const staff = await (
    await request.get(`${API}/api/cms/staff`, { headers: apiHeaders(token) })
  ).json()

  // Берём заведение, к которому кто-то реально привязан: пустая вкладка —
  // тоже законное состояние, но проверять надо наполненное.
  const people = staff.items ?? staff
  const byPoint = new Map<string, number>()
  for (const person of people) {
    for (const assignment of person.assignments ?? []) {
      if (!assignment.is_active) continue
      byPoint.set(assignment.execution_point_id, (byPoint.get(assignment.execution_point_id) ?? 0) + 1)
    }
  }
  const service = (services.items ?? services).find(
    (entry: { execution_point?: { id: string } }) =>
      entry.execution_point && byPoint.has(entry.execution_point.id),
  )
  expect(service, 'на стенде нет заведения с привязанным персоналом').toBeTruthy()
  const expected = byPoint.get(service.execution_point.id) ?? 0

  await signIn(page, ADMIN)
  await page.goto(`/cms/services/${service.id}`)
  await page.getByTestId('service-tab-staff').click()

  const table = page.getByTestId('service-staff-table')
  await expect(table, 'списка людей нет — осталось число со ссылкой').toBeVisible({
    timeout: 25_000,
  })
  await expect(page.locator('[data-testid^="service-staff-row-"]')).toHaveCount(expected)

  // У каждого виден уровень: «кто старший» — половина вопроса, ради которого
  // вкладку и открывают.
  const first = page.locator('[data-testid^="service-staff-level-"]').first()
  // Подписи ровно те, что в словаре ролей: «Сотрудник», «Старший»,
  // «Руководитель». Выдуманные наизусть уже подвели этот тест один раз.
  await expect(first).toHaveText(/Сотрудник|Старший|Руководитель/)
})

test('у заведения без людей вкладка говорит об этом словами', async ({ page, request }) => {
  const token = await apiToken(request)
  const services = await (
    await request.get(`${API}/api/cms/services`, { headers: apiHeaders(token) })
  ).json()
  const staff = await (
    await request.get(`${API}/api/cms/staff`, { headers: apiHeaders(token) })
  ).json()
  const people = staff.items ?? staff
  const busy = new Set<string>()
  for (const person of people) {
    for (const assignment of person.assignments ?? []) {
      if (assignment.is_active) busy.add(assignment.execution_point_id)
    }
  }
  const empty = (services.items ?? services).find(
    (entry: { execution_point?: { id: string } }) =>
      entry.execution_point && !busy.has(entry.execution_point.id),
  )
  test.skip(!empty, 'на стенде все заведения с персоналом — проверять нечего')

  await signIn(page, ADMIN)
  await page.goto(`/cms/services/${empty.id}`)
  await page.getByTestId('service-tab-staff').click()
  await expect(page.getByTestId('service-staff-empty')).toBeVisible({ timeout: 25_000 })
})
