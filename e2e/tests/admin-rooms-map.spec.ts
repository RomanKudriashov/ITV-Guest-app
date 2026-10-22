import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, PLATFORM } from './helpers'

/**
 * НОМЕРНОЙ ФОНД — СХЕМА (партия 63-1). Серверная половина —
 * `backend/tests/hotels/test_room_map_63_1.py`.
 *
 * Свой отель прогона (`origin=test`) на 180 номеров в три этажа и до 80
 * позиций в ряд — чтобы «всё в экране» проверялось на большом корпусе, а не
 * на девяти номерах «Кристалла». Управление номером включено, часть номеров
 * выключена: в легенде два значения — «Мешает гостю» и «Управление не
 * подключено».
 */

const mark = Date.now().toString(36)
const SUB = `fond${mark}`

let headers: Record<string, string> = {}
let hotelId = ''

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

const fond = (extra = '') => `/admin?section=fleet&hotel=${hotelId}&tab=rooms${extra}`

async function openFond(page: Page, extra = '') {
  await page.goto(fond(extra))
  await expect(page.getByTestId('admin-rooms-fix')).toBeVisible({ timeout: 30_000 })
}

/** Нет горизонтальной прокрутки ни у страницы, ни у схемы. */
async function expectFits(page: Page) {
  // Ждём перерисовку после смены масштаба: адрес меняется раньше схемы.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const schemes = [...document.querySelectorAll('[data-testid^="admin-rooms-scheme-"]')].map((el) => el.scrollWidth - el.clientWidth)
          return schemes.length ? Math.max(document.documentElement.scrollWidth - window.innerWidth, ...schemes) : 999
        }),
      { message: 'страница или схема шире окна' },
    )
    .toBeLessThanOrEqual(1)
}

test.describe.serial('Номерной фонд — схема', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000)
    headers = { Authorization: `Bearer ${await platformToken(request)}` }
    const created = await request.post(`${API}/api/v1/platform/hotels`, {
      data: { subdomain: SUB, name: `Фонд ${mark}`, admin_email: `admin@${SUB}.test`, origin: 'test' },
      headers,
    })
    expect(created.ok(), `отель -> ${created.status()} ${await created.text()}`).toBeTruthy()
    const body = await created.json()
    hotelId = body.hotel?.id ?? body.id

    const module = await request.put(`${API}/api/v1/platform/hotels/${hotelId}/modules/room_control`, { data: { enabled: true }, headers })
    expect(module.ok(), `модуль -> ${await module.text()}`).toBeTruthy()

    // Токен панели отеля — входом поддержки, как в analytics-empty.
    const enter = await request.post(`${API}/api/v1/platform/hotels/${hotelId}/enter`, { data: { reason: 'e2e: схема номерного фонда' }, headers })
    expect(enter.ok(), `вход -> ${await enter.text()}`).toBeTruthy()
    const exchanged = await request.post(`${API}/api/staff/auth/support-exchange`, {
      data: { code: (await enter.json()).code },
      headers: { 'X-Hotel-Subdomain': SUB },
    })
    expect(exchanged.ok(), `обмен -> ${await exchanged.text()}`).toBeTruthy()
    const cms = { Authorization: `Bearer ${(await exchanged.json()).access}`, 'X-Hotel-Subdomain': SUB }
    for (const spec of ['2201-2260', '3301-3380', '4401-4440']) {
      const made = await request.post(`${API}/api/cms/rooms/bulk`, { data: { spec }, headers: cms })
      expect(made.ok(), `номера ${spec} -> ${await made.text()}`).toBeTruthy()
    }
    const off = await request.post(`${API}/api/cms/rooms/bulk-update`, {
      data: { selection: { all_matching: true, search: '440' }, patch: { is_active: false } },
      headers: cms,
    })
    expect(off.ok(), `выключить -> ${await off.text()}`).toBeTruthy()
  })

  test.afterAll(async ({ request }) => {
    if (!hotelId) return
    await request.post(`${API}/api/v1/platform/hotels/${hotelId}/purge`, { data: { confirm: SUB }, headers })
    await request.delete(`${API}/api/v1/platform/hotels/${hotelId}`, { headers })
  })

  test('вид по умолчанию — «Схема»: этажи сверху вниз, «Что исправить» сверху', async ({ page }) => {
    await login(page)
    await openFond(page)
    await expect(page.getByTestId('admin-rooms-view-scheme')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('admin-rooms-scheme-none')).toBeVisible()
    await expect(page.getByTestId('admin-rooms-table')).toHaveCount(0)
    await expect(page.getByTestId('admin-rooms-fix-no_variant')).toContainText('Нет варианта')
    await expect(page.getByTestId('admin-rooms-rule')).toContainText('по умолчанию')
    // «Показать» оставляет только эти номера и красит «Что мешает».
    await page.getByTestId('admin-rooms-fix-show-no_variant').click()
    await expect(page).toHaveURL(/problem=no_variant/)
    await expect(page).toHaveURL(/layer=problems/)
  })

  test('карточка номера — у курсора и не уходит за край экрана', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await login(page)
    await openFond(page)
    for (const number of ['3340', '3380']) {
      const cell = page.getByTestId(`admin-room-${number}`)
      const box = (await cell.boundingBox())!
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await page.mouse.move(x, y)
      const card = page.getByTestId('admin-room-card')
      await expect(card).toBeVisible()
      await expect(card).toContainText(number)
      const c = (await card.boundingBox())!
      // Ближайший к курсору угол карточки — в двух десятках точек от него.
      const dx = Math.min(Math.abs(c.x - x), Math.abs(c.x + c.width - x))
      const dy = Math.min(Math.abs(c.y - y), Math.abs(c.y + c.height - y))
      expect(dx, `карточка ${number} далеко от курсора по горизонтали`).toBeLessThan(40)
      expect(dy, `карточка ${number} далеко от курсора по вертикали`).toBeLessThan(40)
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.x + c.width, `карточка ${number} ушла за правый край`).toBeLessThanOrEqual(1440)
      expect(c.y + c.height).toBeLessThanOrEqual(900)
    }
  })

  test('легенда словами со счётчиками; наведение подсвечивает эти номера', async ({ page }) => {
    await login(page)
    await openFond(page)
    const blocked = page.getByTestId('admin-rooms-legend-blocked')
    const off = page.getByTestId('admin-rooms-legend-off')
    await expect(blocked).toContainText(/Мешает гостю — \d+/)
    await expect(off).toContainText(/Управление не подключено — \d+/)
    const opacity = (number: string) => page.getByTestId(`admin-room-${number}`).evaluate((el) => Number(getComputedStyle(el).opacity))
    // 4401 выключен («не подключено»), 2201 — включён («мешает гостю»).
    await off.hover()
    await expect.poll(() => opacity('2201')).toBeLessThan(0.3)
    await expect.poll(() => opacity('4401')).toBeGreaterThan(0.5)
    await blocked.hover()
    await expect.poll(() => opacity('2201')).toBeGreaterThan(0.9)
    await expect.poll(() => opacity('4401')).toBeLessThan(0.3)
    await page.mouse.move(5, 5)
    await expect.poll(() => opacity('2201')).toBeGreaterThan(0.9)
  })

  for (const width of [1440, 390]) {
    test(`всё в экране на ${width}: схема вписана, «+» крупнее, «Вписать» обратно`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await login(page)
      await openFond(page)
      await expectFits(page)
      await page.getByTestId('admin-rooms-zoom-in').click()
      await page.getByTestId('admin-rooms-zoom-in').click()
      await expect(page).toHaveURL(/zoom=2/)
      // Крупнее — листается сама схема, но не страница.
      const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(pageOverflow).toBeLessThanOrEqual(1)
      await page.getByTestId('admin-rooms-zoom-fit').click()
      await expect(page).not.toHaveURL(/zoom=/)
      await expectFits(page)
    })
  }

  test('на телефоне номер открывается листом снизу', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page)
    await openFond(page, '&view=blocks')
    await page.getByTestId('admin-room-2201').click()
    const sheet = page.getByTestId('admin-room-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('Номер 2201')
    const box = (await sheet.boundingBox())!
    expect(box.y + box.height, 'лист не прижат к низу').toBeGreaterThan(780)
  })
})
