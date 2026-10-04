import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, PLATFORM, apiHeaders, apiToken, signInToCms } from './helpers'
import { guestPage } from './brandGuest'

/**
 * У КАЖДОЙ КНОПКИ ЕСТЬ ИМЯ ДЛЯ ЭКРАННОГО ДИКТОРА (партия 30, п.42 бэклога).
 *
 * Аудит (ADM-005) нашёл безымянную кнопку «К списку сервисов». Замер партии 30:
 * сейчас у неё имя есть, и безымянных кнопок на экранах ниже — ноль. Сторож
 * держит это состояние: кнопка-иконка без `aria-label` — красная проверка с
 * названием экрана.
 *
 * Мерится дерево доступности (`ariaSnapshot`), то есть то же, что слышит
 * диктор: строка `- button` без имени в кавычках — безымянная кнопка.
 */

const CMS = [
  '/cms/dashboard',
  '/cms/services',
  '/cms/rooms',
  '/cms/staff',
  '/cms/notifications',
  '/cms/reviews',
  '/cms/orders',
  '/cms/brand',
  '/cms/analytics',
  '/cms/profile',
  '/cms/settings',
  '/cms/dictionaries',
]
const GUEST = ['/home', '/venue/kitchen', '/category/restaurants', '/cart', '/chat', '/orders', '/info', '/search']

async function unnamedButtons(page: Page): Promise<string[]> {
  const snapshot = await page.locator('body').ariaSnapshot()
  return snapshot
    .split('\n')
    .filter((line) => /^\s*- button\b/.test(line) && !/- button "/.test(line))
    .map((line) => line.trim())
}

test('панель отеля: у всех кнопок есть имя', async ({ page, request }) => {
  test.setTimeout(240_000)
  const services = (
    await (await request.get(`${API}/api/cms/services?limit=5`, { headers: apiHeaders(await apiToken(request, ADMIN)) })).json()
  ).items as Array<{ id: string }>
  await page.setViewportSize({ width: 1440, height: 900 })
  await signInToCms(page, ADMIN)
  const found: string[] = []
  for (const route of [...CMS, `/cms/services/${services[0].id}`]) {
    await page.goto(route)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(1200)
    for (const line of await unnamedButtons(page)) found.push(`${route}: ${line}`)
  }
  expect(found, 'кнопки без имени для экранного диктора').toEqual([])
})

test('витрина гостя: у всех кнопок есть имя — телефон и ПК', async ({ browser }) => {
  test.setTimeout(240_000)
  const found: string[] = []
  for (const width of [390, 1440]) {
    const page = await guestPage(browser, { width })
    for (const route of GUEST) {
      await page.goto(route)
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(1200)
      for (const line of await unnamedButtons(page)) found.push(`${width} ${route}: ${line}`)
    }
    await page.context().close()
  }
  expect(found, 'кнопки без имени для экранного диктора').toEqual([])
})

test('консоль платформы: у всех кнопок есть имя', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/admin')
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-health')).toBeVisible({ timeout: 20_000 })
  const found: string[] = []
  for (const route of ['/admin', '/admin/hotels', '/admin/audit', '/admin/team', '/admin/sessions']) {
    await page.goto(route)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(1200)
    for (const line of await unnamedButtons(page)) found.push(`${route}: ${line}`)
  }
  expect(found, 'кнопки без имени для экранного диктора').toEqual([])
})
