import { expect, test } from './fixtures'

/**
 * ВИДИМОЕ ИМЯ ПРОДУКТА — NaviRoom (партия 50, решение тек-лида).
 *
 * Было «ITV Guest App» во вкладке и на входе, «ITV Guest» под значком на
 * домашнем экране и на лендинге, «ITV Platform» в консоли. Проверка смотрит
 * на то, что видит человек, а не на словарь: словарь сторожит
 * `frontend/scripts/check-brand-name.mjs`.
 */

const PORT = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5183').port || '5183'
const ROOT = `http://guest.localhost:${PORT}`
const LANGUAGES = ['ru', 'en', 'ar', 'zh'] as const

test('вкладка и значок PWA — NaviRoom', async ({ page, request }) => {
  await page.goto('/login')
  await expect(page).toHaveTitle('NaviRoom')
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest.name).toBe('NaviRoom')
  expect(manifest.short_name).toBe('NaviRoom')
})

for (const language of LANGUAGES) {
  test(`вход персонала на «${language}» — NaviRoom`, async ({ page }) => {
    await page.addInitScript((lang) => window.localStorage.setItem('itv.lang', lang), language)
    await page.goto('/login')
    await expect(page.getByTestId('login-email')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('NaviRoom', { exact: true }).first()).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/ITV Guest|ITV Platform|ITV 客人应用|تطبيق نزلاء ITV/)
  })
}

test('лендинг — NaviRoom, без почты-заглушки', async ({ page }) => {
  await page.goto(`${ROOT}/`)
  await expect(page.getByTestId('landing-hero')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('landing-contact').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('landing-contact')).toContainText('NaviRoom — гостевой сервис отеля')
  await expect(page.getByTestId('landing-email')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(/ITV Guest|itv\.example/)
})

test('консоль платформы — NaviRoom Platform', async ({ page }) => {
  await page.goto(`${ROOT}/admin`)
  await expect(page.getByTestId('admin-login-email')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('NaviRoom Platform', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('ITV Platform')
})
