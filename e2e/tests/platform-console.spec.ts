import { expect, test } from '@playwright/test'

import { API } from './helpers'

/**
 * Платформенная консоль: логин платформенным аккаунтом → создать отель →
 * витрина нового отеля открывается на его поддомене → hotel-admin логинится в
 * CMS → деактивация → витрина показывает «недоступен».
 *
 * Консоль (базовый домен) гоняем в реальном UI; тенант-сторону нового отеля
 * проверяем API-запросами с override-заголовком поддомена (в dev так резолвится
 * тенант). Отель создаётся с уникальным поддоменом — стенд общий.
 */
test('платформа: создание отеля, вход admin, деактивация', async ({ page, request }) => {
  const sub = `e2e${Date.now().toString().slice(-9)}`
  const adminEmail = `admin@${sub}.test`

  // --- Вход в консоль -------------------------------------------------------
  await page.goto('/platform')
  await page.getByTestId('platform-login-email').fill('platform@itv.local')
  await page.getByTestId('platform-login-password').fill('platform12345')
  await page.getByTestId('platform-login-submit').click()
  await expect(page.getByTestId('platform-console')).toBeVisible({ timeout: 15_000 })

  // --- Создание отеля -------------------------------------------------------
  await page.getByTestId('platform-create-open').click()
  await page.getByTestId('platform-create-subdomain').fill(sub)
  await page.getByTestId('platform-create-name').fill(`E2E ${sub}`)
  await page.getByTestId('platform-create-admin-email').fill(adminEmail)
  await page.getByTestId('platform-create-submit').click()

  // Пароль администратора показан один раз — забираем для проверки логина.
  await expect(page.getByTestId('platform-created-password')).toBeVisible({ timeout: 15_000 })
  const pwText = await page.getByTestId('platform-created-password').innerText()
  const adminPw = pwText.match(/([A-Za-z0-9_-]{12,})/)?.[1] ?? ''
  expect(adminPw.length).toBeGreaterThan(8)
  await page.getByRole('button', { name: 'Готово' }).click()
  await expect(page.getByTestId(`platform-hotel-row-${sub}`)).toBeVisible()

  const tenant = { 'X-Hotel-Subdomain': sub }

  // --- Витрина открывается на поддомене -------------------------------------
  // Номеров ещё нет → 404, но отель резолвится и отдаёт бренд (не системная ошибка).
  const session = await request.post(`${API}/api/guest/session`, {
    data: { room_number: '000' }, headers: tenant,
  })
  const sessionBody = await session.json()
  expect(sessionBody.hotel?.subdomain).toBe(sub)

  // --- hotel-admin логинится в CMS ------------------------------------------
  const login = await request.post(`${API}/api/staff/auth/login`, {
    data: { email: adminEmail, password: adminPw }, headers: tenant,
  })
  expect(login.status(), await login.text()).toBe(200)

  // --- Деактивация в консоли ------------------------------------------------
  await page.getByTestId(`platform-open-${sub}`).click()
  await expect(page.getByTestId('platform-profile')).toBeVisible()
  await page.getByTestId('platform-active-toggle').click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.getByTestId(`platform-hotel-status-${sub}`)).toContainText('Отключён')

  // --- Витрина недоступна ----------------------------------------------------
  const session2 = await request.post(`${API}/api/guest/session`, {
    data: { room_number: '000' }, headers: tenant,
  })
  expect(session2.status()).not.toBe(200)
  const body2 = await session2.json().catch(() => ({}))
  expect(body2.hotel?.subdomain).not.toBe(sub) // бренда отеля больше не отдаёт
})
