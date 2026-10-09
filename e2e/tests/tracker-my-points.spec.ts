import { expect, test } from './fixtures'

import { ADMIN, API, CREDENTIALS, apiHeaders, apiToken, signIn } from './helpers'

/**
 * «МОИ ТОЧКИ» (партия 49, решение тек-лида 9а).
 *
 * Человек на двух точках после входа попадает на «Мои точки»: строка на каждую
 * его точку, чужих нет, касание — доска этой точки. Администратор видит все
 * активные. У кого точка одна — экрана нет, сразу доска.
 */

test('сотрудник на двух точках: после входа — «Мои точки», обе его, чужой нет, касание ведёт на доску', async ({
  page,
  request,
}) => {
  const admin = await apiToken(request, ADMIN)
  const stamp = Date.now().toString(36)
  const email = `two-points-${stamp}@crystal.local`
  const password = 'two-points-12345'
  const points = (await (await request.get(`${API}/api/cms/bootstrap`, { headers: apiHeaders(admin) })).json())
    .execution_points as Array<{ id: string; code: string }>
  const pick = (code: string) => points.find((point) => point.code === code)!
  const created = await request.post(`${API}/api/cms/staff`, {
    headers: apiHeaders(admin),
    data: {
      email,
      full_name: `Две точки ${stamp}`,
      password,
      assignments: [
        { execution_point_id: pick('kitchen').id, level: 'member' },
        { execution_point_id: pick('bar').id, level: 'member' },
      ],
    },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const staffId = (await created.json()).id
  try {
    // Настоящий вход через форму: посадку решает `homePathFor`, а не тест.
    await page.goto('/login')
    await page.getByTestId('login-email').fill(email)
    await page.getByTestId('login-password').fill(password)
    await page.getByTestId('login-submit').click()
    await expect(page).toHaveURL(/\/tracker\/my-points/, { timeout: 25_000 })

    await expect(page.getByTestId('my-points-row-kitchen')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('my-points-row-bar')).toBeVisible()
    await expect(page.locator('[data-testid^="my-points-row-"]')).toHaveCount(2)
    await expect(page.getByTestId('my-points-row-housekeeping')).toHaveCount(0)
    for (const cell of ['new', 'in_work', 'overdue', 'done', 'median_accept']) {
      await expect(page.getByTestId(`my-points-kitchen-${cell}`)).toBeVisible()
    }

    await page.getByTestId('my-points-row-bar').click()
    await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('tracker-point-select')).toContainText(/бар|bar/i)
    // С доски — обратно: кнопка есть у того, у кого точек две и больше.
    await page.getByTestId('tracker-my-points-open').click()
    await expect(page).toHaveURL(/\/tracker\/my-points/)
  } finally {
    await request.delete(`${API}/api/cms/staff/${staffId}`, { headers: apiHeaders(admin) })
  }
})

test('администратор видит строку на каждую активную точку', async ({ page, request }) => {
  const admin = await apiToken(request, ADMIN)
  const active = (await (await request.get(`${API}/api/tracker/points`, { headers: apiHeaders(admin) })).json())
    .points as Array<{ code: string }>
  expect(active.length, 'у демо-отеля точек меньше двух — проверке не о чем').toBeGreaterThan(1)

  await signIn(page, ADMIN)
  await page.goto('/tracker/my-points')
  await expect(page.getByTestId(`my-points-row-${active[0].code}`)).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-testid^="my-points-row-"]')).toHaveCount(active.length)
})

test('одна точка — экрана нет: «Мои точки» уводят на доску, кнопки на доске нет', async ({ page }) => {
  await signIn(page, CREDENTIALS)
  await page.goto('/tracker/my-points')
  await expect(page).toHaveURL(/\/tracker(\?|$)/, { timeout: 20_000 })
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('tracker-my-points-open')).toHaveCount(0)
})
