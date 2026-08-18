import { expect, test, type Page } from '@playwright/test'

import { ADMIN } from './helpers'

/**
 * Сессия не рвётся раньше времени и не оставляет мёртвый экран.
 *
 * Было: refresh-токен ВЫДАВАЛСЯ обоими логинами и не обменивался нигде —
 * ручки обновления не существовало вовсе. CMS складывала его в localStorage
 * и не трогала; консоль выбрасывала прямо на входе (`set` брала один
 * аргумент). Через час access истекал, и дальше расходились: CMS выбрасывала
 * на /login без объяснения, консоль оставляла экран жить и копить 401.
 *
 * Здесь проверяется поведение, а не устройство: пользователь на протухшем
 * access продолжает работать, на протухшем refresh — уходит на вход с
 * текстом, а десять параллельных запросов дают ОДНО обновление.
 */

async function login(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(ADMIN.email)
  await page.getByTestId('login-password').fill(ADMIN.password)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/cms\//, { timeout: 20_000 })
  await expect(page.getByTestId('main-nav')).toBeVisible({ timeout: 20_000 })
}

/** Кладём в хранилище заведомо мёртвый access (подпись верна, срок вышел). */
const DEAD_ACCESS =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJleHAiOjF9.' +
  'x'

test('протухший access: запрос проходит сам, пользователя не выкидывает', async ({
  page,
}) => {
  await login(page)

  let refreshes = 0
  page.on('request', (r) => {
    if (r.url().includes('/auth/refresh')) refreshes += 1
  })

  // Access мёртв, refresh жив — ровно та развилка, ради которой всё делалось.
  await page.evaluate((dead) => window.localStorage.setItem('itv.cms.access', dead), DEAD_ACCESS)

  await page.goto('/cms/services')
  // Данные на экране — значит запрос прошёл, а не отвалился.
  await expect(page.getByTestId('cms-services')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-testid^="service-card-"]').first()).toBeVisible({
    timeout: 20_000,
  })
  await expect(page, 'пользователя выкинуло на вход').not.toHaveURL(/\/login/)

  expect(refreshes, 'обновление должно было произойти ровно одно').toBe(1)
  const stored = await page.evaluate(() => window.localStorage.getItem('itv.cms.access'))
  expect(stored, 'access в хранилище не обновился').not.toBe(DEAD_ACCESS)
})

test('протухший refresh: уводит на вход с текстом, а не в мёртвый экран', async ({
  page,
}) => {
  await login(page)

  // Обе половины мертвы: обновиться нечем.
  await page.evaluate((token) => {
    window.localStorage.setItem('itv.cms.access', token)
    window.localStorage.setItem('itv.cms.refresh', token)
  }, DEAD_ACCESS)

  await page.reload()

  // Ушли на вход — и вход ОБЪЯСНЯЕТСЯ. Молчаливый возврат к форме посреди
  // работы читается как «выкинуло без причины».
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })
  await expect(page.getByTestId('login-error')).toContainText(/истекла/i, { timeout: 20_000 })

  // И хранилище вычищено: мёртвые токены не остаются собирать 401.
  const left = await page.evaluate(() => window.localStorage.getItem('itv.cms.access'))
  expect(left).toBeNull()
})

test('десять параллельных запросов на протухшем access — одно обновление', async ({
  page,
}) => {
  await login(page)
  // Даём фоновым запросам страницы утихнуть, иначе в счёт попадёт чужое.
  await page.waitForTimeout(3000)

  let refreshes = 0
  page.on('request', (r) => {
    if (r.url().includes('/auth/refresh')) refreshes += 1
  })
  await page.evaluate((dead) => window.localStorage.setItem('itv.cms.access', dead), DEAD_ACCESS)

  const results = await page.evaluate(async () => {
    const mod = (await import('/src/api/client.ts')) as {
      api: { get: (p: string) => Promise<unknown> }
    }
    const paths = [
      '/cms/services', '/cms/rooms', '/cms/staff', '/cms/bootstrap', '/cms/navigation',
      '/cms/allergens', '/cms/markers', '/cms/badges', '/cms/schedules', '/cms/locations',
    ]
    return Promise.all(
      paths.map((p) => mod.api.get(p).then(() => 'ok').catch((e: { status?: number }) => `ERR${e.status}`)),
    )
  })

  expect(results.every((r) => r === 'ok'), `не все запросы прошли: ${results.join()}`).toBe(true)
  expect(refreshes, 'десять запросов затеяли несколько обновлений разом').toBe(1)
})

test('консоль платформы: тот же механизм — refresh хранится и обновляет', async ({ page }) => {
  await page.goto('/admin')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/admin')
  await page.getByTestId('admin-login-email').fill('platform@itv.local')
  await page.getByTestId('admin-login-password').fill('platform12345')
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 40_000 })

  // Refresh СОХРАНЁН. Раньше он терялся в точке получения.
  const stored = await page.evaluate(() => ({
    access: window.localStorage.getItem('itv.platform.access'),
    refresh: window.localStorage.getItem('itv.platform.refresh'),
  }))
  expect(stored.access, 'консоль не сохранила access').toBeTruthy()
  expect(stored.refresh, 'консоль выбросила refresh — сессия проживёт только час').toBeTruthy()

  let refreshes = 0
  page.on('request', (r) => {
    if (r.url().includes('/auth/refresh')) refreshes += 1
  })
  await page.evaluate((dead) => window.localStorage.setItem('itv.platform.access', dead), DEAD_ACCESS)
  await page.reload()

  // Оболочка жива, на вход не выкинуло, обновление ровно одно.
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 40_000 })
  expect(refreshes).toBe(1)
})
