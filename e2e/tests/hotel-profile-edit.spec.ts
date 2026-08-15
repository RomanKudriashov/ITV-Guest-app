import { expect, test, type Page } from '@playwright/test'

import { API } from './helpers'

/**
 * Профиль отеля правится с экрана.
 *
 * Ручка `PATCH` умела это с самого начала, а вкладка показывала всё на чтение:
 * чтобы сменить отелю валюту, оператор шёл в curl. Здесь проверяется то, что
 * отличает форму от поля ввода: видно, что изменено; отмена возвращает как
 * было; отказ сервера не отбирает набранное.
 */

const PLATFORM = { email: 'platform@itv.local', password: 'platform12345' }
const DEMO = 'crystal'

async function openHotelCard(page: Page): Promise<void> {
  await page.goto('/admin')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/admin')
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('admin-nav-fleet').click()
  await page.getByTestId('admin-fleet-search').fill(DEMO)
  await page.getByTestId(`admin-fleet-open-${DEMO}`).click()
  await expect(page.getByTestId('admin-hotel')).toBeVisible({ timeout: 20_000 })
}

test.describe('Профиль отеля: правка', () => {
  test('видно, что изменено, и отмена возвращает как было', async ({ page }) => {
    await openHotelCard(page)

    const timezone = page.getByTestId('admin-hotel-timezone-input')
    const was = await timezone.inputValue()

    // До правки сохранять нечего — кнопка заперта.
    await expect(page.getByTestId('admin-hotel-save')).toBeDisabled()
    await expect(page.getByTestId('admin-hotel-dirty')).toHaveCount(0)

    await timezone.fill('Asia/Tokyo')
    await expect(page.getByTestId('admin-hotel-dirty')).toBeVisible()
    await expect(page.getByTestId('admin-hotel-save')).toBeEnabled()

    await page.getByTestId('admin-hotel-cancel').click()
    await expect(timezone).toHaveValue(was)
    await expect(page.getByTestId('admin-hotel-dirty')).toHaveCount(0)
  })

  test('поддомен не правится и объясняет, почему', async ({ page }) => {
    await openHotelCard(page)

    // Поля ввода для поддомена нет вовсе — не «есть, но выключено».
    await expect(page.getByTestId('admin-hotel-subdomain-input')).toHaveCount(0)
    await expect(page.getByTestId('admin-hotel')).toContainText(/QR|ключ отеля/i)
  })

  test('отказ сервера: текст понятный, введённое на месте', async ({ page }) => {
    await openHotelCard(page)

    await page.route('**/api/v1/platform/hotels/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      return route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: '{"detail":"Валюта «XYZ» не поддерживается","code":"validation_error"}',
      })
    })

    const currency = page.getByTestId('admin-hotel-currency-input')
    await currency.fill('XYZ')
    await page.getByTestId('admin-hotel-save').click()

    const error = page.getByTestId('admin-hotel-save-error')
    await expect(error).toBeVisible({ timeout: 15_000 })
    // Текст человеческий: это сообщение сервера про валюту, а не «ApiError».
    await expect(error).toContainText(/Валюта/i)
    await expect(error).not.toContainText(/ApiError|undefined|\[object/)

    // ГЛАВНОЕ: набранное не отобрали вместе с отказом.
    await expect(currency).toHaveValue('XYZ')
    await expect(page.getByTestId('admin-hotel-dirty')).toBeVisible()
  })

  test('роль «только чтение»: сервер отказывает, форма правки не показывается', async ({
    browser,
    request,
  }) => {
    const owner = await request
      .post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
      .then((r) => r.json())
    const invited = await request
      .post(`${API}/api/v1/platform/team`, {
        data: { email: `eyes-${Date.now()}@platform.test`, role: 'read_only' },
        headers: { Authorization: `Bearer ${owner.access}` },
      })
      .then((r) => r.json())

    // Сначала сервер: право на правку — не свойство интерфейса.
    const fleet = await request
      .get(`${API}/api/v1/platform/fleet?search=${DEMO}&origin=all`, {
        headers: { Authorization: `Bearer ${owner.access}` },
      })
      .then((r) => r.json())
    const hotelId = fleet.items[0].id

    const readOnly = await request
      .post(`${API}/api/v1/platform/auth/login`, {
        data: { email: invited.member.email, password: invited.password },
      })
      .then((r) => r.json())
    const refused = await request.patch(`${API}/api/v1/platform/hotels/${hotelId}`, {
      data: { currency: 'USD' },
      headers: { Authorization: `Bearer ${readOnly.access}` },
    })
    expect(refused.status(), 'правка ролью «только чтение»').toBe(403)

    // И экран не предлагает того, чего сервер не разрешит.
    const ctx = await browser.newContext({ locale: 'ru-RU' })
    const page = await ctx.newPage()
    await page.goto('/admin')
    await page.evaluate(() => window.localStorage.clear())
    await page.goto('/admin')
    await page.getByTestId('admin-login-email').fill(invited.member.email)
    await page.getByTestId('admin-login-password').fill(invited.password)
    await page.getByTestId('admin-login-submit').click()
    await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('admin-nav-fleet').click()
    await page.getByTestId('admin-fleet-search').fill(DEMO)
    await page.getByTestId(`admin-fleet-open-${DEMO}`).click()
    await expect(page.getByTestId('admin-hotel')).toBeVisible({ timeout: 20_000 })

    await expect(page.getByTestId('admin-hotel-save')).toHaveCount(0)
    await expect(page.getByTestId('admin-hotel-name-input')).toHaveCount(0)

    await ctx.close()
  })

  test('смена валюты видна в журнале', async ({ page, request }) => {
    await openHotelCard(page)

    const currency = page.getByTestId('admin-hotel-currency-input')
    const was = await currency.inputValue()
    const next = was === 'RUB' ? 'EUR' : 'RUB'

    const saved = page.waitForResponse(
      (r) => r.url().includes('/platform/hotels/') && r.request().method() === 'PATCH',
    )
    await currency.fill(next)
    await page.getByTestId('admin-hotel-save').click()
    expect((await saved).ok(), 'сохранение профиля отклонено').toBeTruthy()

    const owner = await request
      .post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
      .then((r) => r.json())
    const audit = await request
      .get(`${API}/api/v1/platform/audit?action=platform.hotel.updated&limit=20`, {
        headers: { Authorization: `Bearer ${owner.access}` },
      })
      .then((r) => r.json())

    const entry = audit.items.find(
      (row: { payload: { changes?: Record<string, { from: string; to: string }> } }) =>
        row.payload?.changes?.currency?.to === next,
    )
    expect(entry, `смена валюты на ${next} обязана быть в журнале`).toBeTruthy()
    expect(entry.payload.changes.currency.from).toBe(was)

    // Возвращаем стенд как было — он общий.
    await currency.fill(was)
    await page.getByTestId('admin-hotel-save').click()
    await expect(page.getByTestId('admin-hotel-dirty')).toHaveCount(0, { timeout: 15_000 })
  })
})
