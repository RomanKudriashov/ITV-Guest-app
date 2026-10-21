import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, PLATFORM } from './helpers'

/**
 * «ОТЕЛИ» КОНСОЛИ (партия 62-A1): группы отелей одного владельца на одном
 * экране с отелями. Серверная половина — `backend/tests/hotels/test_hotel_groups.py`.
 *
 * Отели прогона заводятся с признаком автотеста (`origin=test`) и видны
 * экрану только с `origin=all` в адресе; за собой убираем отели и группу.
 */

const mark = Date.now().toString().slice(-6)
const ALPHA = `alf${mark}`
const BETA = `bet${mark}`
const GROUP = `Группа ${mark}`

let headers: Record<string, string> = {}
const ids: Record<string, string> = {}
let groupId = ''
let groupCode = ''

async function platformToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
  expect(response.ok(), `вход в консоль -> ${response.status()}`).toBeTruthy()
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

const screen = (query = '') => `/admin?section=fleet&origin=all&search=${mark}${query}`

test.describe.serial('Отели и группы', () => {
  test.beforeAll(async ({ request }) => {
    headers = { Authorization: `Bearer ${await platformToken(request)}` }
    for (const [sub, name] of [[ALPHA, `Альфа ${mark}`], [BETA, `Бета ${mark}`]]) {
      const created = await request.post(`${API}/api/v1/platform/hotels`, {
        data: { subdomain: sub, name, admin_email: `admin@${sub}.test`, origin: 'test' },
        headers,
      })
      expect(created.ok(), `отель ${sub} -> ${created.status()} ${await created.text()}`).toBeTruthy()
      const body = await created.json()
      ids[sub] = body.hotel?.id ?? body.id
    }
    const group = await request.post(`${API}/api/v1/platform/groups`, {
      data: { title: GROUP, color: 'gold', hotel_ids: [ids[ALPHA]] },
      headers,
    })
    expect(group.status(), await group.text()).toBe(201)
    const body = await group.json()
    groupId = body.id
    groupCode = body.code
  })

  test.afterAll(async ({ request }) => {
    if (groupId) await request.delete(`${API}/api/v1/platform/groups/${groupId}?confirm_title=${encodeURIComponent(GROUP)}`, { headers })
    for (const [sub, id] of Object.entries(ids)) {
      await request.delete(`${API}/api/v1/platform/hotels/${id}?confirm_subdomain=${sub}`, { headers })
    }
  })

  test('по группам: найденная по названию группа раскрыта, найденное подсвечено, сводка группы видна', async ({ page }) => {
    await login(page)
    await page.goto(`/admin?section=fleet&origin=all&search=${encodeURIComponent(GROUP)}`)
    const block = page.getByTestId(`admin-hotels-group-${groupCode}`)
    await expect(block).toBeVisible({ timeout: 20_000 })
    await expect(block.locator('mark[data-hl]').first()).toHaveText(GROUP)
    await expect(block.getByTestId(`admin-fleet-row-${ALPHA}`)).toBeVisible()
    await expect(page.getByTestId(`admin-fleet-row-${BETA}`)).toHaveCount(0)
    await expect(page.getByTestId(`admin-hotels-group-${groupCode}-summary`)).toContainText('1 отель')
  })

  test('УКУС: фильтры в адресе — чипы видны, переживают перезагрузку, крестик снимает', async ({ page }) => {
    await login(page)
    await page.goto(screen())
    await expect(page.getByTestId(`admin-fleet-row-${ALPHA}`)).toBeVisible({ timeout: 20_000 })

    await page.getByTestId('admin-hotels-facet-group').click()
    await page.getByTestId('admin-hotels-option-group-none').click()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/[?&]group=none/)
    const chip = page.getByTestId('admin-hotels-chip-group-none')
    await expect(chip).toBeVisible()
    await expect(page.getByTestId(`admin-fleet-row-${BETA}`)).toBeVisible()
    await expect(page.getByTestId(`admin-fleet-row-${ALPHA}`)).toHaveCount(0)

    await page.reload()
    await expect(page.getByTestId('admin-hotels-chip-group-none')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId(`admin-fleet-row-${ALPHA}`)).toHaveCount(0)

    await page.getByTestId('admin-hotels-chip-group-none').getByRole('button').click()
    await expect(page).not.toHaveURL(/[?&]group=/)
    await expect(page.getByTestId(`admin-fleet-row-${ALPHA}`)).toBeVisible()
  })

  test('общим списком: у отеля видна его группа', async ({ page }) => {
    await login(page)
    await page.goto(screen('&layout=list'))
    const row = page.getByTestId(`admin-fleet-row-${ALPHA}`)
    await expect(row).toBeVisible({ timeout: 20_000 })
    await expect(row).toContainText(GROUP)
    await expect(page.getByTestId(`admin-fleet-row-${BETA}`)).toContainText('без группы')
  })

  test('«В группу…» переносит отель; удаление группы оставляет отели без группы', async ({ page, request }) => {
    await login(page)
    await page.goto(screen())
    await page.getByTestId(`admin-fleet-pick-${BETA}`).check()
    await page.getByTestId('admin-hotels-bulk-move').click()
    await page.getByTestId(`admin-group-move-to-${groupId}`).click()
    await page.getByTestId('admin-group-move-submit').click()
    const block = page.getByTestId(`admin-hotels-group-${groupCode}`)
    await expect(block.getByTestId(`admin-fleet-row-${BETA}`)).toBeVisible({ timeout: 20_000 })

    await page.getByTestId(`admin-group-delete-${groupCode}`).click()
    const submit = page.getByTestId('admin-group-delete-submit')
    await expect(submit).toBeDisabled()
    await page.getByTestId('admin-group-delete-confirm').fill(GROUP)
    await submit.click()
    await expect(block).toHaveCount(0, { timeout: 20_000 })
    const loose = page.getByTestId('admin-hotels-group-none')
    await expect(loose.getByTestId(`admin-fleet-row-${ALPHA}`)).toBeVisible()
    await expect(loose.getByTestId(`admin-fleet-row-${BETA}`)).toBeVisible()
    groupId = ''

    // Отели живы и включены.
    const listed = await (await request.get(`${API}/api/v1/platform/fleet?layout=list&origin=all&search=${mark}`, { headers })).json()
    expect(listed.items.map((r: { subdomain: string; is_active: boolean }) => [r.subdomain, r.is_active]).sort()).toEqual([
      [ALPHA, true],
      [BETA, true],
    ])
  })

  test('на телефоне — карточки, переключатель вида и фильтры на месте', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page)
    await page.goto(screen())
    await expect(page.getByTestId(`admin-fleet-row-${ALPHA}`)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('admin-hotels-layout-list')).toBeVisible()
    await expect(page.getByTestId('admin-hotels-facet-state')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, 'горизонтальная прокрутка на 390').toBeLessThanOrEqual(1)
  })
})
