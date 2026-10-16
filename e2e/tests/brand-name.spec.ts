import type { Page } from '@playwright/test'

import { expect, test } from './fixtures'

import { PLATFORM } from './helpers'

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

async function loginConsoleByForm(page: Page): Promise<void> {
  await page.goto(`${ROOT}/admin`)
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 30_000 })
}

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

test('лендинг — NaviRoom, без заглушек почты и телефона', async ({ page }) => {
  await page.goto(`${ROOT}/`)
  await expect(page.getByTestId('landing-hero')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('landing-contact').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('landing-contact')).toContainText('NaviRoom — гостевой сервис отеля')
  await expect(page.getByTestId('landing-email')).toHaveCount(0)
  // Телефон-заглушка ушёл вслед за почтой (партия 51).
  await expect(page.getByTestId('landing-phone')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(/ITV Guest|itv\.example|000-00-00/)
})

/*
  КОНСОЛЬ — NaviRoom Control (партия 53): латиницей, на всех языках одинаково.
  Смотрим три места, где имя видит человек: марка и заголовок на входе, вкладка
  браузера, марка в сайдбаре после входа.
*/
for (const language of LANGUAGES) {
  test(`NaviRoom Control на «${language}» — на входе и во вкладке, без «Root · admin»`, async ({ page }) => {
    await page.addInitScript((lang) => window.localStorage.setItem('itv.lang', lang), language)
    await page.goto(`${ROOT}/admin`)
    await expect(page.getByTestId('admin-login-email')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('NaviRoom Control', { exact: true })).toHaveCount(2)
    await expect(page).toHaveTitle('NaviRoom Control')
    await expect(page.locator('body')).not.toContainText(
      /ITV Platform|NaviRoom Platform|Корневая админка|Root admin|Root · admin|لوحة الجذر|根管理台/,
    )
  })
}

test('NaviRoom Control после входа — в сайдбаре и во вкладке, без «Root · admin»', async ({ page }) => {
  await loginConsoleByForm(page)
  await expect(page.getByTestId('admin-shell')).toContainText('NaviRoom Control')
  await expect(page.getByTestId('admin-brand-mark')).toHaveText('NC')
  await expect(page).toHaveTitle('NaviRoom Control')
  await expect(page.getByTestId('admin-shell')).not.toContainText(/NaviRoom Platform|Root · admin/i)
})
