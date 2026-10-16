import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, HOTEL, PLATFORM, apiHeaders, apiToken, signIn } from './helpers'

/**
 * ОБРАЗЦЫ СТЕКЛЯННОГО СТИЛЯ И «← НАЗАД» (партия 56, шаг 1).
 *
 * Правило стиля: стекло — на рамке (меню, шапка, плитки, панель фильтров),
 * содержимое — плотное (поля, таблица). «← Назад» подписан именем родителя и
 * ведёт на родителя по карте маршрутов, а не по истории браузера.
 */

const ROOT_PORT = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5183').port || '5183'
const ROOT = `http://guest.localhost:${ROOT_PORT}`

const isGlass = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const s = getComputedStyle(el)
    const alpha = Number((s.backgroundColor.match(/rgba?\(([^)]+)\)/)?.[1] ?? '').split(/[ ,/]+/)[3] ?? 1)
    return { blur: s.backdropFilter.includes('blur'), alpha }
  })

test('блюдо: «← Меню «…»» ведёт в меню своего заведения, по карте, а не по истории', async ({ page, request }) => {
  const token = await apiToken(request, ADMIN)
  const items = await (await request.get(`${API}/api/v1/cms/items?search=Брускетта`, { headers: apiHeaders(token) })).json()
  const item = (Array.isArray(items) ? items : items.items)[0]
  const categories = await (await request.get(`${API}/api/v1/cms/categories?all_types=1`, { headers: apiHeaders(token) })).json()
  const walk = (nodes: Array<{ id: string; children?: unknown[] }>): Array<Record<string, unknown>> =>
    nodes.flatMap((node) => [node as Record<string, unknown>, ...walk((node.children ?? []) as Array<{ id: string }>)])
  const category = walk(categories).find((row) => row.id === item.category_id)!
  expect(category.service_id, 'у раздела не назван сервис').toBeTruthy()

  await signIn(page, ADMIN)
  // Прямой заход (как по ссылке из письма): истории нет — «назад» всё равно знает родителя.
  await page.goto(`/cms/menu/items/${item.id}`)
  const back = page.getByTestId('item-back-button')
  await expect(back).toBeVisible({ timeout: 20_000 })
  await expect(back).toHaveText(/Меню «.+»/)
  await expect(back).toHaveAttribute('href', new RegExp(`/services/${category.service_id}$`))
  await back.click()
  await expect(page).toHaveURL(new RegExp(`/services/${category.service_id}`))
  await expect(page.getByTestId('cms-service-workspace')).toBeVisible({ timeout: 20_000 })
})

test('дашборд и редактор: рамка — стекло, поля — плотные; на других экранах стекла нет', async ({ page }) => {
  await signIn(page, ADMIN)
  await page.goto('/cms/dashboard')
  await expect(page.getByTestId('cms-dashboard')).toBeVisible({ timeout: 20_000 })
  const bar = await isGlass(page, 'header.MuiAppBar-root')
  expect(bar.blur && bar.alpha < 1, 'шапка дашборда не стеклянная').toBeTruthy()
  const tile = await isGlass(page, '[data-testid="cms-dashboard"] .MuiCard-root')
  expect(tile.blur && tile.alpha < 1, 'плитка дашборда не стеклянная').toBeTruthy()

  // Стекло — только у образцов (шаг 1): соседний экран остаётся прежним.
  await page.goto('/cms/staff')
  await expect(page.getByTestId('cms-page-title')).toBeVisible({ timeout: 20_000 })
  const plain = await isGlass(page, 'header.MuiAppBar-root')
  expect(plain.blur, 'стекло протекло на экран, который не образец').toBeFalsy()
})

test('Control, список отелей: фильтры — на стекле, реестр — плотный', async ({ page }) => {
  await page.goto(`${ROOT}/admin`)
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 30_000 })
  await page.goto(`${ROOT}/admin?section=fleet`)
  await expect(page.getByTestId(`admin-fleet-row-${HOTEL}`)).toBeVisible({ timeout: 20_000 })
  const filters = await page.getByTestId('admin-fleet-search').evaluate((el) => {
    let n: Element | null = el
    while (n && !getComputedStyle(n).backdropFilter.includes('blur')) n = n.parentElement
    return Boolean(n)
  })
  expect(filters, 'панель фильтров не стеклянная').toBeTruthy()
  const table = await page.locator('[data-testid="admin-fleet"] table').evaluate((el) => {
    const s = getComputedStyle(el.parentElement!)
    return { bg: s.backgroundColor, blur: s.backdropFilter }
  })
  expect(table.blur.includes('blur'), 'реестр размыт — содержимое должно быть плотным').toBeFalsy()
  expect(table.bg, 'реестр полупрозрачный').not.toMatch(/rgba\([^)]*,\s*0?\.\d+\)/)
})
