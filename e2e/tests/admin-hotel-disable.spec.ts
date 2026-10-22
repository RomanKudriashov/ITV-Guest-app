import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, PLATFORM } from './helpers'

/**
 * ОТКЛЮЧЕНИЕ ОТЕЛЯ И ПРОФИЛЬ (партия 62-C): отключение с причиной — гостю
 * заглушка в бренде, сотруднику «Вход недоступен», причина только в Control;
 * профиль по языкам, опасная правка через окно последствий; смена поддомена —
 * старый адрес и старый QR ведут на новый. Серверная половина —
 * `backend/tests/hotels/test_hotel_disable_profile.py`.
 */

const mark = Date.now().toString().slice(-6)
const SUB = `dis${mark}`
const NEW = `dis${mark}n`
const REASON = `Неоплата e2e ${mark}`

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

/** Открыть витрину или панель как будто на адресе отеля (дев: ключ `itv.dev.hotel`). */
async function asHotel(page: Page, subdomain: string, path: string) {
  await page.goto('/admin')
  await page.evaluate((sub) => {
    window.localStorage.setItem('itv.dev.hotel', sub)
    window.localStorage.removeItem('itv.cms.access')
    window.localStorage.removeItem('itv.cms.refresh')
  }, subdomain)
  await page.goto(path)
}

const card = (tab: string) => `/admin?section=fleet&hotel=${hotelId}&tab=${tab}`

test.describe.serial('Отключение отеля и профиль', () => {
  test.beforeAll(async ({ request }) => {
    headers = { Authorization: `Bearer ${await platformToken(request)}` }
    const created = await request.post(`${API}/api/v1/platform/hotels`, {
      data: { subdomain: SUB, name: `Отключение ${mark}`, admin_email: `admin@${SUB}.test`, origin: 'test', languages: ['ru', 'en'] },
      headers,
    })
    expect(created.ok(), await created.text()).toBeTruthy()
    const body = await created.json()
    hotelId = body.hotel?.id ?? body.id
  })

  test.afterAll(async ({ request }) => {
    if (!hotelId) return
    const profile = await (await request.get(`${API}/api/v1/platform/hotels/${hotelId}`, { headers })).json()
    for (const alias of profile.aliases ?? []) {
      await request.delete(`${API}/api/v1/platform/hotels/${hotelId}/aliases/${alias.old}`, { headers })
    }
    await request.delete(`${API}/api/v1/platform/hotels/${hotelId}?confirm_subdomain=${profile.subdomain}`, { headers })
  })

  test('УКУС: отключение с причиной — гостю заглушка, сотруднику «Вход недоступен», причина только в Control', async ({ page }) => {
    await login(page)
    await page.goto(card('overview'))
    await page.getByTestId('admin-overview-disable').click()
    await expect(page.getByTestId('admin-disable-submit')).toBeDisabled()
    await page.getByTestId('admin-disable-reason').fill(REASON)
    await page.getByTestId('admin-disable-submit').click()
    await expect(page.getByTestId('admin-hotel-disabled-reason')).toContainText(REASON, { timeout: 20_000 })
    await expect(page.getByTestId('admin-hotel-state')).toHaveText('отключён')

    // Гость по QR — заглушка в бренде отеля, без причины.
    await asHotel(page, SUB, '/r/101')
    await expect(page.getByTestId('guest-hotel-closed')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('guest-hotel-closed')).toContainText('Отель временно не принимает заказы')
    await expect(page.locator('body')).not.toContainText(REASON)

    // Сотрудник: форма видна, вход — «Вход недоступен».
    await asHotel(page, SUB, '/cms')
    await page.getByTestId('login-email').fill(`admin@${SUB}.test`)
    await page.getByTestId('login-password').fill('любой-пароль')
    await page.getByTestId('login-submit').click()
    await expect(page.locator('body')).toContainText('Вход недоступен', { timeout: 15_000 })
    await expect(page.locator('body')).not.toContainText(REASON)
  })

  test('включение возвращает витрину', async ({ page }) => {
    await login(page)
    await page.goto(card('overview'))
    await page.getByTestId('admin-overview-enable').click()
    await page.getByTestId('admin-overview-active-confirm-confirm').click()
    await expect(page.getByTestId('admin-hotel-state')).not.toHaveText('отключён', { timeout: 20_000 })
    await asHotel(page, SUB, '/r/101')
    await page.waitForTimeout(1500)
    await expect(page.getByTestId('guest-hotel-closed')).toHaveCount(0)
  })

  test('профиль: перевод названия на втором языке не трогает основной; пояс — через окно последствий', async ({ page, request }) => {
    await login(page)
    await page.goto(card('profile'))
    await page.getByTestId('admin-hotel-name-en').fill(`Shutdown ${mark}`)
    await page.getByTestId('admin-hotel-save').click()
    await expect(page.getByTestId('admin-hotel-dirty')).toHaveCount(0, { timeout: 20_000 })
    const profile = await (await request.get(`${API}/api/v1/platform/hotels/${hotelId}`, { headers })).json()
    expect(profile.name_i18n).toMatchObject({ ru: `Отключение ${mark}`, en: `Shutdown ${mark}` })

    await page.getByTestId('admin-hotel-timezone-input').click()
    await page.locator('[role="option"][data-value="Asia/Tokyo"]').click()
    await page.getByTestId('admin-hotel-save').click()
    await expect(page.getByTestId('admin-profile-confirm-timezone')).toContainText('08:00', { timeout: 20_000 })
    await page.getByTestId('admin-profile-confirm-submit').click()
    await expect(page.getByTestId('admin-profile-confirm')).toHaveCount(0, { timeout: 20_000 })

    await page.getByTestId('admin-hotel-tab-history').click()
    // Пояс в истории — словами, не кодом (партия 62-F): «Япония, … (UTC+9)».
    const zone = page.getByTestId('admin-journal-change-timezone').first()
    await expect(zone).toContainText('UTC+9', { timeout: 20_000 })
    await expect(zone).not.toContainText('Asia/Tokyo')
  })

  test('УКУС: новый поддомен — старый адрес и старый QR ведут на новый с тем же путём', async ({ page, request }) => {
    await login(page)
    await page.goto(card('profile'))
    await page.getByTestId('admin-hotel-subdomain-input').fill(NEW)
    await page.getByTestId('admin-hotel-subdomain-save').click()
    await expect(page.getByTestId('admin-profile-confirm-subdomain')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('admin-profile-confirm-submit').click()
    await expect(page.getByTestId(`admin-hotel-alias-${SUB}`)).toBeVisible({ timeout: 20_000 })

    // Сервер по старому адресу отвечает новым.
    const status = await (await request.get(`${API}/api/v1/hotel/status`, { headers: { 'X-Hotel-Subdomain': SUB } })).json()
    expect(status.state).toBe('moved')
    expect(status.location).toContain(`${NEW}.`)

    // Приложение по старому QR уходит на новый адрес С ТЕМ ЖЕ путём.
    // Порт у адреса — того, через кого спросили (прокси дева), поэтому сверяем
    // поддомен и путь.
    const onNew = (url: URL) => url.hostname.startsWith(`${NEW}.`)
    await page.route(onNew, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>moved</body></html>' }))
    await asHotel(page, SUB, '/r/305')
    await expect.poll(() => new URL(page.url()).hostname, { timeout: 20_000 }).toMatch(new RegExp(`^${NEW}\\.`))
    expect(new URL(page.url()).pathname).toBe('/r/305')

    // Снимается вручную — и старый адрес больше никуда не ведёт.
    await page.unroute(onNew)
    await page.goto('/admin')
    await page.evaluate(() => window.localStorage.removeItem('itv.dev.hotel'))
    await page.goto(card('profile'))
    await page.getByTestId(`admin-hotel-alias-remove-${SUB}`).click()
    await expect(page.getByTestId(`admin-hotel-alias-${SUB}`)).toHaveCount(0, { timeout: 20_000 })
    const gone = await request.get(`${API}/api/v1/hotel/status`, { headers: { 'X-Hotel-Subdomain': SUB } })
    expect(gone.status()).toBe(404)
  })

  test('на телефоне — окно отключения и профиль без горизонтальной прокрутки', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page)
    for (const tab of ['overview', 'profile']) {
      await page.goto(card(tab))
      await expect(page.getByTestId(`admin-hotel-tab-${tab}`)).toHaveAttribute('data-active', 'true', { timeout: 20_000 })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, `горизонтальная прокрутка на 390 (${tab})`).toBeLessThanOrEqual(1)
    }
    await page.getByTestId('admin-hotel-tab-overview').click()
    await page.getByTestId('admin-overview-disable').click()
    await expect(page.getByTestId('admin-disable-dialog')).toBeVisible()
    await page.keyboard.press('Escape')
  })
})
