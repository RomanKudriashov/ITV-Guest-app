import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, PLATFORM } from './helpers'

/**
 * КАРТОЧКА ОТЕЛЯ (партия 62-B): девять вкладок-адресов, обзор с готовностью,
 * подключения своего отеля, номерной фонд, журнал; «On-premise» и «Сессии
 * поддержки» ушли из меню. Серверная половина —
 * `backend/tests/hotels/test_hotel_card_readiness.py`.
 *
 * Свой отель прогона (`origin=test`) — для того, что меняется; «Кристалл» —
 * только для чтения (номера, управление номером).
 */

const mark = Date.now().toString().slice(-6)
const SUB = `card${mark}`
const GROUP = `Карточка ${mark}`

let headers: Record<string, string> = {}
let hotelId = ''
let groupId = ''
let crystalId = ''

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

const card = (id: string, tab: string, extra = '') => `/admin?section=fleet&hotel=${id}&tab=${tab}${extra}`

test.describe.serial('Карточка отеля', () => {
  test.beforeAll(async ({ request }) => {
    headers = { Authorization: `Bearer ${await platformToken(request)}` }
    const created = await request.post(`${API}/api/v1/platform/hotels`, {
      data: { subdomain: SUB, name: `Карточка ${mark}`, admin_email: `admin@${SUB}.test`, origin: 'test' },
      headers,
    })
    expect(created.ok(), `отель -> ${created.status()} ${await created.text()}`).toBeTruthy()
    const body = await created.json()
    hotelId = body.hotel?.id ?? body.id
    const group = await request.post(`${API}/api/v1/platform/groups`, { data: { title: GROUP, hotel_ids: [hotelId] }, headers })
    expect(group.status(), await group.text()).toBe(201)
    groupId = (await group.json()).id
    const fleet = await (await request.get(`${API}/api/v1/platform/fleet?layout=list&origin=all&search=crystal`, { headers })).json()
    crystalId = fleet.items.find((r: { subdomain: string }) => r.subdomain === 'crystal')?.id ?? ''
  })

  test.afterAll(async ({ request }) => {
    if (groupId) await request.delete(`${API}/api/v1/platform/groups/${groupId}?confirm_title=${encodeURIComponent(GROUP)}`, { headers })
    if (hotelId) await request.delete(`${API}/api/v1/platform/hotels/${hotelId}?confirm_subdomain=${SUB}`, { headers })
  })

  test('обзор: проблемы с важностью, «Пройдено», «исправить» ведёт на вкладку; строка «Отели › Группа › Отель»', async ({ page }) => {
    await login(page)
    await page.goto(`/admin?section=fleet&hotel=${hotelId}`)
    await expect(page.getByTestId('admin-overview')).toBeVisible({ timeout: 20_000 })
    // Новый отель: меню нет и администратор не входил — ровно две проблемы.
    await expect(page.getByTestId('admin-hotel-state')).toHaveText('2 проблемы')
    await expect(page.getByTestId('admin-hotel-tab-badge')).toHaveText('2')
    await expect(page.getByTestId('admin-problem-no_menu_service')).toHaveAttribute('data-severity', 'warn')
    await expect(page.getByTestId('admin-problem-admin_never_logged_in')).toContainText(`admin@${SUB}.test`)
    await expect(page.getByTestId('admin-passed-module_without_connection')).toBeVisible()

    await expect(page.getByTestId('admin-crumb-hotel-group')).toHaveText(GROUP)
    await page.getByTestId('admin-problem-fix-admin_never_logged_in').click()
    await expect(page).toHaveURL(/tab=profile/)

    await page.getByTestId('admin-crumb-hotel-group').click()
    await expect(page.getByTestId('admin-group-page')).toBeVisible({ timeout: 20_000 })
  })

  test('вкладка и подвкладка — в адресе; старые ключи ведут туда, куда переехало', async ({ page }) => {
    test.skip(!crystalId, 'на стенде нет «Кристалла»')
    await login(page)
    await page.goto(card(crystalId, 'roomControl', '&sub=versions'))
    await expect(page.getByTestId('admin-grms-tab-versions')).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 })
    await page.getByTestId('admin-grms-tab-plan').click()
    await expect(page).toHaveURL(/sub=plan/)
    await page.reload()
    await expect(page.getByTestId('admin-grms-tab-plan')).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 })

    for (const [old, now] of [['support', 'journal'], ['activity', 'history'], ['tariff', 'modules'], ['usage', 'modules']]) {
      await page.goto(card(crystalId, old))
      await expect(page.getByTestId(`admin-hotel-tab-${now}`)).toHaveAttribute('data-active', 'true', { timeout: 20_000 })
    }
    await expect(page.getByTestId('admin-hotel-usage')).toBeVisible()
  })

  test('номерной фонд: поиск и фильтры в адресе, считает сервер', async ({ page }) => {
    test.skip(!crystalId, 'на стенде нет «Кристалла»')
    await login(page)
    await page.goto(card(crystalId, 'rooms', '&search=30'))
    await expect(page.getByTestId('admin-rooms')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('admin-room-301')).toBeVisible()
    await expect(page.getByTestId('admin-room-201')).toHaveCount(0)
    await page.getByTestId('admin-hotels-reset').click()
    await expect(page.getByTestId('admin-room-201')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('admin-rooms-count')).toContainText('Показано')
  })

  test('УКУС: подключения своего отеля — выдать ключ один раз, отозвать с подтверждением, обзор краснеет', async ({ page }) => {
    await login(page)
    await page.goto(card(hotelId, 'connections'))
    await page.getByTestId('admin-node-create').click()
    await page.getByTestId('admin-node-name').fill('e2e-коробка')
    await page.getByTestId('admin-node-create-submit').click()
    await expect(page.getByTestId('admin-node-key')).toContainText(/один раз/)
    await expect(page.getByTestId('admin-node-status-e2e-коробка')).toHaveText('офлайн', { timeout: 20_000 })
    await expect(page.getByTestId('admin-connections-vendor')).toHaveText('iRidi')

    // Узел ни разу не выходил на связь — обзор краснеет сразу, без минуты кэша.
    await page.getByTestId('admin-hotel-tab-overview').click()
    await expect(page.getByTestId('admin-problem-connector_silent')).toHaveAttribute('data-severity', 'bad', { timeout: 20_000 })

    await page.getByTestId('admin-hotel-tab-connections').click()
    await page.getByTestId('admin-node-revoke-e2e-коробка').click()
    await page.getByTestId('admin-node-confirm-e2e-коробка-confirm').click()
    await expect(page.getByTestId('admin-node-status-e2e-коробка')).toHaveText('ключ отозван', { timeout: 20_000 })
    await page.getByTestId('admin-hotel-tab-overview').click()
    await expect(page.getByTestId('admin-problem-connector_silent')).toHaveCount(0, { timeout: 20_000 })
  })

  test('отключить (с причиной) и включить отель с обзора', async ({ page }) => {
    await login(page)
    await page.goto(card(hotelId, 'overview'))
    await page.getByTestId('admin-overview-disable').click()
    // Отключение — с причиной (партия 62-C).
    await page.getByTestId('admin-disable-reason').fill('e2e: карточка')
    await page.getByTestId('admin-disable-submit').click()
    await expect(page.getByTestId('admin-hotel-state')).toHaveText('отключён', { timeout: 20_000 })
    await page.getByTestId('admin-overview-enable').click()
    await page.getByTestId('admin-overview-active-confirm-confirm').click()
    await expect(page.getByTestId('admin-hotel-state')).toHaveText(/проблем/, { timeout: 20_000 })
  })

  test('«On-premise» и «Сессии поддержки» ушли из меню, старые адреса ведут к фильтрам', async ({ page }) => {
    await login(page)
    await expect(page.getByTestId('admin-nav-fleet')).toBeVisible()
    await expect(page.getByTestId('admin-nav-nodes')).toHaveCount(0)
    await expect(page.getByTestId('admin-nav-support')).toHaveCount(0)

    await page.goto('/admin?section=nodes')
    await expect(page).toHaveURL(/link=silent/, { timeout: 20_000 })
    await expect(page.getByTestId('admin-hotels-chip-link-silent')).toBeVisible({ timeout: 20_000 })

    await page.goto('/admin?section=support')
    await expect(page).toHaveURL(/section=audit/, { timeout: 20_000 })
    await expect(page.getByTestId('admin-audit-view-support')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('admin-support-sessions')).toBeVisible()
  })

  test('на телефоне — девять вкладок листаются, страница не уезжает вбок', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page)
    for (const tab of ['overview', 'connections', 'rooms', 'journal']) {
      await page.goto(card(hotelId, tab))
      await expect(page.getByTestId(`admin-hotel-tab-${tab}`)).toHaveAttribute('data-active', 'true', { timeout: 20_000 })
      await page.waitForTimeout(400)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, `горизонтальная прокрутка на 390 (${tab})`).toBeLessThanOrEqual(1)
    }
  })
})
