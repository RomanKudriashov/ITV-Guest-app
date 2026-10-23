import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, PLATFORM } from './helpers'

/**
 * НОМЕРНОЙ ФОНД — ПРАВКА ИЗ CONTROL (партия 63-1). Серверная половина —
 * `backend/tests/hotels/test_room_edit_63_1.py`.
 *
 * Свой отель прогона (`origin=test`): окно номера (разделы, сохранение,
 * ← →, Esc, несохранённые правки), добавление номеров («+» в конце этажа,
 * предпросмотр, дубль), удаление с последствиями, PIN один раз, корпуса;
 * пустой отель — большая кнопка; «только чтение» — без кнопок.
 */

const mark = Date.now().toString(36)
const SUB = `edit${mark}`
const EMPTY = `void${mark}`

let headers: Record<string, string> = {}
let cms: Record<string, string> = {}
let hotelId = ''
let emptyId = ''
let readOnly = { id: '', email: `ro${mark}@platform.test`, access: '', refresh: '' }

async function platformToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
  expect(response.ok(), `вход в консоль -> ${response.status()}`).toBeTruthy()
  return (await response.json()).access
}

async function hotel(request: APIRequestContext, sub: string): Promise<string> {
  const created = await request.post(`${API}/api/v1/platform/hotels`, {
    data: { subdomain: sub, name: `Правка ${mark}`, admin_email: `admin@${sub}.test`, origin: 'test' },
    headers,
  })
  expect(created.ok(), `отель -> ${created.status()} ${await created.text()}`).toBeTruthy()
  const body = await created.json()
  return body.hotel?.id ?? body.id
}

/** Вход в Control токенами в браузер — минуя форму (у «только чтение» своя пара). */
async function enter(page: Page, tokens?: { access: string; refresh: string }) {
  if (!tokens) {
    const response = await page.request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
    tokens = await response.json()
  }
  await page.goto('/admin')
  await page.evaluate(([a, r]) => {
    window.localStorage.clear()
    window.localStorage.setItem('itv.platform.access', a)
    window.localStorage.setItem('itv.platform.refresh', r)
  }, [tokens!.access, tokens!.refresh])
}

const fond = (id: string, extra = '') => `/admin?section=fleet&hotel=${id}&tab=rooms${extra}`

async function openFond(page: Page, id = hotelId, extra = '') {
  await page.goto(fond(id, extra))
  await expect(page.getByTestId('admin-rooms')).toBeVisible({ timeout: 30_000 })
}

async function cmsRoom(request: APIRequestContext, number: string) {
  const rooms = await (await request.get(`${API}/api/cms/rooms?search=${number}`, { headers: cms })).json()
  return rooms.items.find((r: { number: string }) => r.number === number)
}

test.describe.serial('Номерной фонд — правка из Control', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000)
    headers = { Authorization: `Bearer ${await platformToken(request)}` }
    hotelId = await hotel(request, SUB)
    emptyId = await hotel(request, EMPTY)
    const module = await request.put(`${API}/api/v1/platform/hotels/${hotelId}/modules/room_control`, { data: { enabled: true }, headers })
    expect(module.ok(), await module.text()).toBeTruthy()
    const enterHotel = await request.post(`${API}/api/v1/platform/hotels/${hotelId}/enter`, { data: { reason: 'e2e: правка фонда' }, headers })
    const exchanged = await request.post(`${API}/api/staff/auth/support-exchange`, { data: { code: (await enterHotel.json()).code }, headers: { 'X-Hotel-Subdomain': SUB } })
    expect(exchanged.ok(), await exchanged.text()).toBeTruthy()
    cms = { Authorization: `Bearer ${(await exchanged.json()).access}`, 'X-Hotel-Subdomain': SUB }
    const made = await request.post(`${API}/api/cms/rooms/bulk`, { data: { spec: '2201-2206, 3301-3306' }, headers: cms })
    expect(made.ok(), await made.text()).toBeTruthy()
    const invited = await request.post(`${API}/api/v1/platform/team`, { data: { email: readOnly.email, role: 'read_only' }, headers })
    expect(invited.status(), await invited.text()).toBe(201)
    const body = await invited.json()
    readOnly.id = body.member.id
    const login = await (await request.post(`${API}/api/v1/platform/auth/login`, { data: { email: readOnly.email, password: body.password } })).json()
    readOnly = { ...readOnly, access: login.access, refresh: login.refresh }
  })

  test.afterAll(async ({ request }) => {
    for (const [id, sub] of [[hotelId, SUB], [emptyId, EMPTY]]) {
      if (!id) continue
      await request.post(`${API}/api/v1/platform/hotels/${id}/purge`, { data: { confirm: sub }, headers })
      await request.delete(`${API}/api/v1/platform/hotels/${id}`, { headers })
    }
    if (readOnly.id) await request.patch(`${API}/api/v1/platform/team/${readOnly.id}`, { data: { is_active: false }, headers })
  })

  test('окно номера: правка видна в панели отеля и наоборот; ← → по номерам; Esc закрывает', async ({ page, request }) => {
    await enter(page)
    await openFond(page)
    await page.getByTestId('admin-room-2202').click()
    await expect(page.getByTestId('admin-room-dialog-title')).toHaveText('Номер 2202')
    await expect(page).toHaveURL(/room=/)
    for (const section of ['main', 'control', 'access', 'state', 'problems', 'history']) await expect(page.getByTestId(`admin-room-tab-${section}`)).toBeVisible()

    await page.getByTestId('admin-room-floor').fill('7')
    await page.getByTestId('admin-room-save').click()
    await expect(page.getByTestId('admin-room-dialog-status')).toHaveText('Сохранено')
    await expect(page.getByTestId('admin-room-floor')).toHaveValue('7')
    expect((await cmsRoom(request, '2202')).floor, 'правка Control не видна в панели').toBe('7')

    // Обратно: панель поменяла — окно показывает новое.
    const room = await cmsRoom(request, '2202')
    await request.patch(`${API}/api/cms/rooms/${room.id}`, { data: { floor: '8' }, headers: cms })
    await page.reload()
    await expect(page.getByTestId('admin-room-floor')).toHaveValue('8', { timeout: 30_000 })

    // ← → — соседний номер (фокус не в поле). 2202 теперь на 8-м этаже —
    // нижний ряд схемы, последний номер: следующего нет, предыдущий есть.
    await expect(page.getByTestId('admin-room-next')).toBeDisabled()
    await page.getByTestId('admin-room-tab-state').click()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('admin-room-dialog-title')).not.toHaveText('Номер 2202')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('admin-room-dialog-title')).toHaveText('Номер 2202')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('admin-room-dialog')).toHaveCount(0)
    await expect(page).not.toHaveURL(/room=/)
  })

  test('несохранённые правки — спросить перед уходом', async ({ page }) => {
    await enter(page)
    await openFond(page)
    await page.getByTestId('admin-room-2203').click()
    await page.getByTestId('admin-room-floor').fill('99')
    await page.getByTestId('admin-room-dialog-close').click()
    await expect(page.getByTestId('admin-room-leave')).toBeVisible()
    await page.getByTestId('admin-room-leave-cancel').click()
    await expect(page.getByTestId('admin-room-floor')).toHaveValue('99')
    await page.getByTestId('admin-room-next').click()
    await expect(page.getByTestId('admin-room-leave')).toBeVisible()
    await page.getByTestId('admin-room-leave-ok').click()
    await expect(page.getByTestId('admin-room-dialog-title')).not.toHaveText('Номер 2203')
  })

  test('«+» в конце этажа: этаж подставлен, предпросмотр, дубль пропускается', async ({ page }) => {
    await enter(page)
    await openFond(page)
    await page.getByTestId('admin-rooms-add-floor-22').click()
    await expect(page.getByTestId('admin-rooms-add-floor')).toHaveValue('22')
    await page.getByTestId('admin-rooms-add-spec').fill('2290-2292, 2201')
    await expect(page.getByTestId('admin-rooms-add-will')).toContainText('Добавится — 3')
    await expect(page.getByTestId('admin-rooms-add-exists')).toContainText('2201')
    await page.getByTestId('admin-rooms-add-submit').click()
    await expect(page.getByTestId('admin-rooms-toast')).toHaveText('Добавлено номеров: 3')
    await expect(page.getByTestId('admin-room-2291')).toBeVisible()
  })

  test('удаление — с подтверждением и последствиями; добавление снова — «вернуть или завести заново»', async ({ page }) => {
    await enter(page)
    await openFond(page)
    await page.getByTestId('admin-room-3306').click()
    await page.getByTestId('admin-room-delete').click()
    await expect(page.getByTestId('admin-room-delete-impact')).toContainText('Живых сессий гостей нет')
    await page.getByTestId('admin-room-delete-confirm-ok').click()
    await expect(page.getByTestId('admin-room-dialog')).toHaveCount(0)
    await expect(page.getByTestId('admin-room-3306')).toHaveCount(0)
    await page.getByTestId('admin-rooms-add').click()
    await page.getByTestId('admin-rooms-add-spec').fill('3306')
    await expect(page.getByTestId('admin-rooms-add-buried')).toContainText('3306')
    await expect(page.getByTestId('admin-rooms-add-restore-yes')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('admin-rooms-add-submit').click()
    await expect(page.getByTestId('admin-room-3306')).toBeVisible()
  })

  test('PIN: сгенерированный показан один раз', async ({ page }) => {
    await enter(page)
    await openFond(page)
    await page.getByTestId('admin-room-2204').click()
    await page.getByTestId('admin-room-tab-access').click()
    await page.getByTestId('admin-room-pin-generate').click()
    await expect(page.getByTestId('admin-room-pin-shown')).toContainText(/\d{6}/)
    await expect(page.getByTestId('admin-room-pin-state')).toContainText('PIN действует')
    await page.keyboard.press('Escape')
    await page.getByTestId('admin-room-2204').click()
    await page.getByTestId('admin-room-tab-access').click()
    await expect(page.getByTestId('admin-room-pin-state')).toContainText('PIN действует')
    await expect(page.getByTestId('admin-room-pin-shown')).toHaveCount(0)
  })

  test('корпуса: добавить, переименовать на языках отеля, удалить с переносом номеров', async ({ page, request }) => {
    await enter(page)
    await openFond(page)
    await page.getByTestId('admin-rooms-buildings').click()
    // Корпусов у отеля нет — окно сразу открывается полем нового корпуса.
    await expect(page.getByTestId('admin-dict-editor')).toBeVisible()
    await page.getByTestId('admin-dict-title-ru').fill(`Северный ${mark}`)
    await page.getByTestId('admin-dict-save').click()
    const item = page.locator('[data-testid^="admin-dict-item-"]').filter({ hasText: `Северный ${mark}` })
    await expect(item).toBeVisible()
    const code = ((await item.getAttribute('data-testid')) ?? '').replace('admin-dict-item-', '')
    await page.getByTestId(`admin-dict-rename-${code}`).click()
    await page.getByTestId('admin-dict-title-ru').fill(`Полярный ${mark}`)
    await page.getByTestId('admin-dict-save').click()
    await expect(page.getByTestId(`admin-dict-item-${code}`)).toContainText(`Полярный ${mark}`)
    await page.keyboard.press('Escape')

    // Номер — в корпус; удаление корпуса с номером — только с переносом.
    const dict = await (await request.get(`${API}/api/v1/platform/hotels/${hotelId}/rooms/dictionaries`, { headers })).json()
    const building = dict.buildings.find((b: { code: string }) => b.code === code)
    const room = await cmsRoom(request, '2205')
    await request.patch(`${API}/api/v1/platform/hotels/${hotelId}/rooms/${room.id}`, { data: { building_id: building.id }, headers })
    await page.reload()
    await page.getByTestId('admin-rooms-buildings').click()
    await page.getByTestId(`admin-dict-delete-${code}`).click()
    await expect(page.getByTestId('admin-dict-delete-confirm')).toContainText('В корпусе номеров: 1')
    await page.getByTestId('admin-dict-delete-confirm-ok').click()
    await expect(page.getByTestId(`admin-dict-item-${code}`)).toHaveCount(0)
    expect((await cmsRoom(request, '2205')).building_id, 'номер не переехал «без корпуса»').toBeNull()
  })

  test('пустой отель — большая кнопка «Добавить первые номера»', async ({ page }) => {
    await enter(page)
    await openFond(page, emptyId)
    await expect(page.getByTestId('admin-rooms-empty')).toBeVisible()
    await page.getByTestId('admin-rooms-add-first').click()
    await expect(page.getByTestId('admin-rooms-add-dialog')).toBeVisible()
  })

  test('«только чтение»: окна открываются, кнопок правки нет', async ({ page }) => {
    await enter(page, readOnly)
    await openFond(page)
    await expect(page.getByTestId('admin-room-2201')).toBeVisible()
    await expect(page.getByTestId('admin-rooms-add')).toHaveCount(0)
    await expect(page.locator('[data-testid^="admin-rooms-add-floor-"]')).toHaveCount(0)
    await expect(page.getByTestId('admin-rooms-rule-edit')).toHaveCount(0)
    await page.getByTestId('admin-room-2201').click()
    await expect(page.getByTestId('admin-room-dialog-title')).toHaveText('Номер 2201')
    await expect(page.getByTestId('admin-room-save')).toHaveCount(0)
    await expect(page.getByTestId('admin-room-delete')).toHaveCount(0)
    await expect(page.getByTestId('admin-room-floor')).toBeDisabled()
    await page.getByTestId('admin-room-tab-access').click()
    await expect(page.getByTestId('admin-room-pin-generate')).toHaveCount(0)
  })
})
