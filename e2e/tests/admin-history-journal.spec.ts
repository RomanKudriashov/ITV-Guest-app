import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, PLATFORM } from './helpers'

/**
 * ИСТОРИЯ И ЖУРНАЛЫ (партия 62-D): «История» отеля — правки из Control с
 * «было → стало», фильтры в адресе переживают F5, листание дальше 50;
 * «Журнал действий», «Пользователи», «Подключения» — фильтры на сервере и
 * в адресе; даты по-русски. Серверная половина —
 * `backend/tests/hotels/test_journal_62d.py`.
 */

const mark = Date.now().toString().slice(-6)
const SUB = `hist${mark}`

let headers: Record<string, string> = {}
let hotelId = ''

async function platformToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).access
}

async function login(page: Page) {
  await page.goto('/admin')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/admin')
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 30_000 })
}

test.describe.serial('История и журналы', () => {
  test.beforeAll(async ({ request }) => {
    headers = { Authorization: `Bearer ${await platformToken(request)}` }
    const created = await request.post(`${API}/api/v1/platform/hotels`, {
      data: { subdomain: SUB, name: `История ${mark}`, admin_email: `admin@${SUB}.test`, origin: 'test' },
      headers,
    })
    expect(created.ok(), await created.text()).toBeTruthy()
    const body = await created.json()
    hotelId = body.hotel?.id ?? body.id
    // Модуль включили и выключили, город правили 55 раз — истории больше 50.
    await request.put(`${API}/api/v1/platform/hotels/${hotelId}/modules/marketing`, { data: { enabled: true }, headers })
    await request.put(`${API}/api/v1/platform/hotels/${hotelId}/modules/marketing`, { data: { enabled: false }, headers })
    for (let n = 0; n < 55; n += 1) {
      await request.patch(`${API}/api/v1/platform/hotels/${hotelId}`, { data: { city: { ru: `Город ${n}` } }, headers })
    }
    await request.post(`${API}/api/v1/platform/hotels/${hotelId}/nodes`, { data: { name: 'e2e-box', purpose: 'grms' }, headers })
  })

  test.afterAll(async ({ request }) => {
    if (hotelId) await request.delete(`${API}/api/v1/platform/hotels/${hotelId}?confirm_subdomain=${SUB}`, { headers })
  })

  test('УКУС: модуль — «был → стал» по коду; фильтр «что» в адресе переживает F5; даты по-русски', async ({ page }) => {
    await login(page)
    await page.goto(`/admin?section=fleet&hotel=${hotelId}&tab=history`)
    await expect(page.getByTestId('admin-history')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('admin-hotels-facet-what').click()
    await page.getByRole('menuitem', { name: /Модули/ }).click()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/what=modules/)
    await page.reload()
    await expect(page.getByTestId('admin-hotels-chip-what-modules')).toBeVisible({ timeout: 20_000 })
    const rows = page.getByTestId('admin-history-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.first().getByTestId('admin-journal-change-module:marketing')).toContainText('Маркетинг: включён → выключен')
    await expect(rows.first()).toContainText(/\d{1,2} [а-я]{3}\.? \d{4}/) // «21 окт. 2026 г.», а не «10/21/2026»
    await expect(rows.first()).not.toContainText(/\d{1,2}\/\d{1,2}\/\d{4}/)
  })

  test('УКУС: история листается дальше 50 — «Показать ещё»', async ({ page }) => {
    await login(page)
    await page.goto(`/admin?section=fleet&hotel=${hotelId}&tab=history&what=profile:city`)
    await expect(page.getByTestId('admin-history-count')).toHaveText('Показано 50 из 55', { timeout: 20_000 })
    await page.getByTestId('admin-history-more').click()
    await expect(page.getByTestId('admin-history-count')).toHaveText('Показано 55 из 55', { timeout: 20_000 })
    await expect(page.getByTestId('admin-history-more')).toHaveCount(0)
  })

  test('журнал действий: отель, период и текст — в адресе и на сервере, F5 их не теряет', async ({ page }) => {
    await login(page)
    const asked = page.waitForRequest((r) => r.url().includes('/audit?') && r.url().includes(`search=${SUB}`) && r.url().includes('period=day'), { timeout: 20_000 })
    await page.goto(`/admin?section=audit&search=${SUB}&period=day`)
    await asked
    await expect(page.getByTestId('admin-hotels-chip-period-day')).toBeVisible({ timeout: 20_000 })
    await page.reload()
    await expect(page.getByTestId('admin-fleet-search')).toHaveValue(SUB, { timeout: 20_000 })
    await expect(page.getByTestId('admin-audit-platform.hotel.modules_set').first()).toBeVisible()
    await expect(page.getByTestId('admin-audit-total')).toContainText('из')
  })

  test('пользователи и подключения — фильтры в адресе', async ({ page }) => {
    await login(page)
    await page.goto('/admin?section=team&role=owner')
    await expect(page.getByTestId('admin-hotels-chip-role-owner')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId(`admin-team-row-${PLATFORM.email}`)).toBeVisible()

    await page.goto(`/admin?section=fleet&hotel=${hotelId}&tab=connections&status=offline`)
    await expect(page.getByTestId('admin-node-e2e-box')).toBeVisible({ timeout: 20_000 })
    await page.goto(`/admin?section=fleet&hotel=${hotelId}&tab=connections&status=online`)
    await expect(page.getByTestId('admin-node-e2e-box')).toHaveCount(0, { timeout: 20_000 })
  })
})
