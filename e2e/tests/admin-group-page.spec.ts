import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, PLATFORM } from './helpers'

/**
 * СТРАНИЦА ГРУППЫ (партия 62-A2): сводка, отели, профиль, действия по всей
 * группе, умолчания для новых отелей, история. Серверная половина —
 * `backend/tests/hotels/test_hotel_groups.py`.
 *
 * Отели прогона — с признаком автотеста (`origin=test`); за собой убираем
 * отели и группы.
 */

const mark = Date.now().toString().slice(-6)
const A = `gpa${mark}`
const B = `gpb${mark}`
const C = `gpc${mark}`
const MAIN = `Главная ${mark}`
const OTHER = `Соседняя ${mark}`

let headers: Record<string, string> = {}
const ids: Record<string, string> = {}
const groups: Record<string, { id: string; code: string; title: string }> = {}

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

async function modulesOf(request: APIRequestContext, sub: string): Promise<string[]> {
  const list = await (await request.get(`${API}/api/v1/platform/fleet?layout=list&origin=all&search=${sub}`, { headers })).json()
  return list.items.find((r: { subdomain: string }) => r.subdomain === sub)?.modules ?? []
}

const groupPage = (key: string, tab = 'summary') => `/admin?section=fleet&gpage=${groups[key].id}&gtab=${tab}`

test.describe.serial('Страница группы', () => {
  test.beforeAll(async ({ request }) => {
    headers = { Authorization: `Bearer ${await platformToken(request)}` }
    for (const [sub, name] of [[A, `Альфа ${mark}`], [B, `Бета ${mark}`], [C, `Гамма ${mark}`]]) {
      const created = await request.post(`${API}/api/v1/platform/hotels`, {
        data: { subdomain: sub, name, admin_email: `admin@${sub}.test`, origin: 'test' },
        headers,
      })
      expect(created.ok(), `отель ${sub} -> ${created.status()} ${await created.text()}`).toBeTruthy()
      const body = await created.json()
      ids[sub] = body.hotel?.id ?? body.id
    }
    for (const [key, title, hotels] of [['main', MAIN, [A, B]], ['other', OTHER, [C]]] as const) {
      const response = await request.post(`${API}/api/v1/platform/groups`, { data: { title, hotel_ids: hotels.map((h) => ids[h]) }, headers })
      expect(response.status(), await response.text()).toBe(201)
      const body = await response.json()
      groups[key] = { id: body.id, code: body.code, title }
    }
  })

  test.afterAll(async ({ request }) => {
    for (const g of Object.values(groups)) {
      await request.delete(`${API}/api/v1/platform/groups/${g.id}?confirm_title=${encodeURIComponent(g.title)}`, { headers })
    }
    for (const [sub, id] of Object.entries(ids)) {
      await request.delete(`${API}/api/v1/platform/hotels/${id}?confirm_subdomain=${sub}`, { headers })
    }
  })

  test('открывается из «Отелей» по названию группы; вкладка в адресе переживает перезагрузку', async ({ page }) => {
    await login(page)
    await page.goto(`/admin?section=fleet&origin=all&search=${mark}`)
    await page.getByTestId(`admin-hotels-group-${groups.main.code}-open`).click()
    await expect(page.getByTestId('admin-group-page')).toBeVisible({ timeout: 20_000 })
    await expect(page).toHaveURL(new RegExp(`gpage=${groups.main.id}`))
    await expect(page.getByTestId('admin-crumb-group')).toContainText(MAIN)
    await expect(page.getByTestId('admin-group-summary')).toContainText('2')

    await page.getByTestId('admin-group-tab-history').click()
    await expect(page).toHaveURL(/gtab=history/)
    await page.reload()
    await expect(page.getByTestId('admin-group-history')).toBeVisible({ timeout: 20_000 })
  })

  test('УКУС: действие по группе показывает план по каждому отелю и меняет ровно его', async ({ page, request }) => {
    await login(page)
    await page.goto(groupPage('main', 'actions'))
    await page.getByTestId('admin-group-action-open-module').click()
    await page.getByTestId('admin-group-action-module-marketing').click()
    const plan = page.getByTestId('admin-group-action-plan')
    await expect(plan.getByTestId(`admin-group-plan-${A}`)).toContainText('включится', { timeout: 20_000 })
    await expect(plan.getByTestId(`admin-group-plan-${B}`)).toContainText('включится')
    await page.getByTestId('admin-group-action-submit').click()
    await expect(page.getByTestId('admin-group-action-module')).toHaveCount(0, { timeout: 20_000 })

    expect(await modulesOf(request, A)).toContain('marketing')
    expect(await modulesOf(request, B)).toContain('marketing')
    expect(await modulesOf(request, C), 'модуль включился у отеля другой группы').not.toContain('marketing')

    // Повторный показ — «уже так», выполнять нечего.
    await page.getByTestId('admin-group-action-open-module').click()
    await page.getByTestId('admin-group-action-module-marketing').click()
    await expect(page.getByTestId(`admin-group-plan-${A}`)).toContainText('уже так', { timeout: 20_000 })
    await expect(page.getByTestId('admin-group-action-submit')).toBeDisabled()
  })

  test('отключение всех отелей группы требует причину', async ({ page }) => {
    await login(page)
    await page.goto(groupPage('main', 'actions'))
    await page.getByTestId('admin-group-action-open-disable').click()
    await expect(page.getByTestId(`admin-group-plan-${A}`)).toContainText('отключится', { timeout: 20_000 })
    await expect(page.getByTestId('admin-group-action-submit')).toBeDisabled()
    await page.getByTestId('admin-group-action-reason').fill('проверка')
    await expect(page.getByTestId('admin-group-action-submit')).toBeEnabled()
    await page.keyboard.press('Escape')
  })

  test('умолчания включают модуль ПРИШЕДШЕМУ отелю, «переедет из» видно при добавлении', async ({ page, request }) => {
    await login(page)
    await page.goto(groupPage('main', 'defaults'))
    await page.getByTestId('admin-group-defaults-switch').click()
    await expect(page.getByTestId('admin-group-defaults-state')).toContainText('Правило включено', { timeout: 20_000 })
    await page.getByTestId('admin-group-defaults-room_control').click()
    await expect(page.getByTestId('admin-group-defaults-state')).toContainText('Управление номером', { timeout: 20_000 })
    expect(await modulesOf(request, A), 'правило тронуло отель, который уже был в группе').not.toContain('room_control')

    await page.goto(groupPage('main', 'hotels'))
    await page.getByTestId('admin-group-add-open').click()
    await page.getByTestId(`admin-group-pick-${C}`).click()
    await expect(page.getByTestId('admin-group-add')).toContainText(`Переедет из группы «${OTHER}»`)
    await page.getByTestId('admin-group-add-submit').click()
    await expect(page.getByTestId(`admin-group-hotel-${C}`)).toBeVisible({ timeout: 20_000 })
    expect(await modulesOf(request, C)).toContain('room_control')
  })

  test('УКУС: история показывает переименование «было → стало»', async ({ page }) => {
    await login(page)
    await page.goto(groupPage('main', 'profile'))
    const title = page.getByTestId('admin-group-profile-title')
    await title.fill(`${MAIN} 2`)
    await title.blur()
    await expect(page.getByTestId('admin-crumb-group')).toContainText(`${MAIN} 2`, { timeout: 20_000 })
    groups.main.title = `${MAIN} 2`

    await page.getByTestId('admin-group-tab-history').click()
    const row = page.getByTestId('admin-group-history-row').filter({ hasText: 'Название' }).first()
    await expect(row).toContainText(MAIN, { timeout: 20_000 })
    await expect(row).toContainText(`→ ${MAIN} 2`)
  })

  test('на телефоне — вкладки листаются, без горизонтальной прокрутки', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page)
    await page.goto(groupPage('main', 'hotels'))
    await expect(page.getByTestId(`admin-group-hotel-${A}`)).toBeVisible({ timeout: 20_000 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, 'горизонтальная прокрутка на 390').toBeLessThanOrEqual(1)
  })
})
