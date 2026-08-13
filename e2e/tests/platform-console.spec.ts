import { expect, test } from '@playwright/test'

import { API } from './helpers'

/**
 * Корневая админка: вход платформенным аккаунтом → создать отель → витрина
 * нового отеля открывается на его поддомене → hotel-admin логинится в CMS →
 * отключение → витрина показывает «недоступен».
 *
 * Админку (базовый домен) гоняем в реальном UI; тенант-сторону нового отеля
 * проверяем API-запросами с override-заголовком поддомена (в dev так резолвится
 * тенант). Отель создаётся с уникальным поддоменом — стенд общий.
 */
test('админка: создание отеля, вход admin, отключение', async ({ page, request }) => {
  const sub = `e2e${Date.now().toString().slice(-9)}`
  const adminEmail = `admin@${sub}.test`

  // --- Вход в админку -------------------------------------------------------
  // Заходим по СТАРОМУ адресу: он обязан увести на /admin, а не в 404 —
  // ссылка на мастер-ключ платформы осталась в закладках.
  await page.goto('/platform')
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 })
  await page.getByTestId('admin-login-email').fill('platform@itv.local')
  await page.getByTestId('admin-login-password').fill('platform12345')
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 15_000 })

  // Сводка — первый экран владельца.
  await expect(page.getByTestId('admin-overview')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('admin-kpi-hotels')).toBeVisible()

  // --- Создание отеля -------------------------------------------------------
  await page.getByTestId('admin-nav-fleet').click()
  await expect(page.getByTestId('admin-fleet')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('admin-create-open').click()
  await page.getByTestId('admin-create-subdomain').fill(sub)
  await page.getByTestId('admin-create-name').fill(`E2E ${sub}`)
  await page.getByTestId('admin-create-admin-email').fill(adminEmail)
  await page.getByTestId('admin-create-submit').click()

  // Пароль администратору УХОДИТ ПИСЬМОМ и оператору не показывается — консоль
  // сообщает только адрес доставки. Раньше он был виден здесь, и отсюда же его
  // забирал этот прогон.
  await expect(page.getByTestId('admin-created-sent')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('admin-created-sent')).toContainText(adminEmail)
  await page.getByTestId('admin-created-done').click()

  // Поиск во флоте находит новый отель.
  await page.getByTestId('admin-fleet-search').fill(sub)
  await expect(page.getByTestId(`admin-fleet-row-${sub}`)).toBeVisible({ timeout: 15_000 })

  const tenant = { 'X-Hotel-Subdomain': sub }

  // --- Витрина открывается на поддомене -------------------------------------
  // Номеров ещё нет → 404, но отель резолвится и отдаёт бренд (не системная ошибка).
  const session = await request.post(`${API}/api/guest/session`, {
    data: { room_number: '000' }, headers: tenant,
  })
  const sessionBody = await session.json()
  expect(sessionBody.hotel?.subdomain).toBe(sub)

  // Проверки «hotel-admin логинится в CMS» здесь БОЛЬШЕ НЕТ: пароль знает
  // только сам администратор, и взять его прогону неоткуда. Вернуть покрытие
  // можно почтовой службой в компоузе (mailpit и т.п.), из которой прогон
  // читал бы письмо; пока её нет, это осознанная потеря, а не недосмотр.

  // --- Отключение в карточке отеля ------------------------------------------
  await page.getByTestId(`admin-fleet-open-${sub}`).click()
  await expect(page.getByTestId('admin-hotel')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('admin-hotel-active').click()
  await page.getByTestId('admin-hotel-back').click()
  await page.getByTestId('admin-fleet-search').fill(sub)
  await expect(page.getByTestId(`admin-fleet-status-${sub}`)).toContainText(/Отключ/, {
    timeout: 15_000,
  })

  // --- Витрина недоступна ----------------------------------------------------
  const session2 = await request.post(`${API}/api/guest/session`, {
    data: { room_number: '000' }, headers: tenant,
  })
  expect(session2.status()).not.toBe(200)
  const body2 = await session2.json().catch(() => ({}))
  expect(body2.hotel?.subdomain).not.toBe(sub) // бренда отеля больше не отдаёт
})
