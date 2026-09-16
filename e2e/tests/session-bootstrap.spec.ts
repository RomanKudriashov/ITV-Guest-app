import { expect, test } from './fixtures'

import { ADMIN, API, HOTEL, SESSION_KEYS } from './helpers'

/**
 * ПЕРЕХОД ВО ВРЕМЯ ПРОВЕРКИ ТОКЕНА НЕ ЗАКРЫВАЕТ СЕССИЮ.
 *
 * Панель при загрузке спрашивает `/auth/me`. Раньше ЛЮБАЯ неудача этого
 * запроса вела в «выйти», а «выйти» рвёт сессию на сервере. Уход со страницы
 * обрывает запрос — и человек, просто перешедший по ссылке, закрывал свою
 * живую сессию: токен ещё действовал, а в «Моих входах» не было «это
 * устройство». Так краснела проверка «мои входы» в полном прогоне (пункт 32).
 */

test('быстрый переход между экранами не рвёт живую сессию', async ({ page, request }) => {
  const login = await request.post(`${API}/api/staff/auth/login`, {
    data: ADMIN,
    headers: { 'X-Hotel-Subdomain': HOTEL },
  })
  expect(login.ok()).toBeTruthy()
  const { access, refresh } = await login.json()

  await page.addInitScript(
    ([accessKey, refreshKey, a, r]) => {
      window.localStorage.setItem(accessKey, a)
      window.localStorage.setItem(refreshKey, r)
    },
    [SESSION_KEYS.cms.access, SESSION_KEYS.cms.refresh, access, refresh] as const,
  )

  // Уходим, когда страница загружена, а проверка токена ещё идёт: ответ
  // задерживаем, чтобы переход гарантированно оборвал запрос на живой странице.
  await page.route('**/api/v1/staff/auth/me', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    await route.continue().catch(() => undefined)
  })
  for (const path of ['/cms/dashboard', '/cms/staff']) {
    const sent = page.waitForRequest('**/api/v1/staff/auth/me')
    await page.goto(path)
    await sent
  }
  await page.unroute('**/api/v1/staff/auth/me')
  await page.goto('/cms/profile')
  await expect(page.getByTestId('sessions-panel')).toBeVisible({ timeout: 20_000 })

  const sessions = await request.get(`${API}/api/staff/auth/sessions`, {
    headers: { Authorization: `Bearer ${access}`, 'X-Hotel-Subdomain': HOTEL },
  })
  const body = await sessions.json()
  expect(body.current, 'сессия этого входа закрыта обрывом запроса').not.toBeNull()
  await expect(page.getByTestId('session-row-current')).toHaveCount(1)
})
