import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, DEMO_ROOM } from './helpers'

/**
 * ОШИБКИ БЕЗ СЫРОГО HTML (партия 39).
 *
 * На экран входа гостя на sialia.naviapp.navicentric.ru (ныне третья база; главная —
 * naviroom.navicentric.ru, партия 50) попала сырая страница
 * Django «<!doctype html>…Bad Request (400)…»: клиент клал тело ответа в
 * текст ошибки, если оно не JSON. Теперь тело показывается, только если это
 * наш JSON с текстом, иначе — фраза по коду на языке интерфейса
 * (`frontend/src/api/httpError.ts`). Здесь ответ подменяется ровно такой
 * страницей — на входе гостя, панели и консоли.
 */

const DJANGO_400 =
  '<!doctype html>\n<html lang="en">\n<head>\n  <title>Bad Request (400)</title>\n</head>\n<body>\n  <h1>Bad Request (400)</h1><p></p>\n</body>\n</html>\n'

async function answerWithHtml400(page: Page, url: RegExp): Promise<void> {
  await page.route(url, (route) =>
    route.fulfill({ status: 400, contentType: 'text/html; charset=utf-8', body: DJANGO_400 }),
  )
}

async function expectHumanText(page: Page, testId: string): Promise<void> {
  const banner = page.getByTestId(testId)
  await expect(banner).toBeVisible({ timeout: 20_000 })
  const text = (await banner.innerText()).trim()
  expect(text, 'в плашке — разметка ответа сервера').not.toMatch(/<|doctype|Bad Request|html/i)
  expect(text).toContain('Запрос не принят')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('itv.lang', 'ru')
  })
})

test('вход гостя по номеру: HTML 400 — человеческий текст', async ({ page }) => {
  await answerWithHtml400(page, /\/api\/(v1\/)?guest\/session/)
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expectHumanText(page, 'guest-entry-error')
})

test('вход в панель: HTML 400 — человеческий текст', async ({ page }) => {
  await answerWithHtml400(page, /\/api\/(v1\/)?staff\/auth\/login/)
  await page.goto('/login')
  await page.getByTestId('login-email').fill(ADMIN.email)
  await page.getByTestId('login-password').fill(ADMIN.password)
  await page.getByTestId('login-submit').click()
  await expectHumanText(page, 'login-error')
})

test('вход в консоль: HTML 400 — человеческий текст', async ({ page }) => {
  await answerWithHtml400(page, /\/api\/(v1\/)?platform\/auth\/login/)
  await page.goto('/admin')
  await page.getByTestId('admin-login-email').fill('platform@itv.local')
  await page.getByTestId('admin-login-password').fill('platform12345')
  await page.getByTestId('admin-login-submit').click()
  await expectHumanText(page, 'admin-login-error')
})
