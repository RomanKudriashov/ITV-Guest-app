import { type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, PLATFORM, RESTAURANT_MANAGER, signIn, signInPlatform } from './helpers'

/**
 * ПАРТИЯ 60 — ТО, ЧТО ЧИНИТСЯ НА ЭКРАНЕ.
 *
 * Права и порча данных проверяются на сервере (`test_batch60_bites.py`); здесь —
 * то, чего сервер не видит: какие кнопки экран показывает, что он отправляет и
 * что обещает словами. На стенде ничего не пишется, кроме учётки «только
 * чтение» в команде платформы (её заводят и соседние проверки консоли).
 */

async function readOnlyAccount(request: APIRequestContext) {
  const owner = await request
    .post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
    .then((r) => r.json())
  const invited = await request
    .post(`${API}/api/v1/platform/team`, {
      data: { email: `eyes60-${Date.now()}@platform.test`, role: 'read_only' },
      headers: { Authorization: `Bearer ${owner.access}` },
    })
    .then((r) => r.json())
  return { email: invited.member.email as string, password: invited.password as string }
}

test.describe('CMS: экран говорит правду', () => {
  test('номерной фонд: у каждой строки столько ячеек, сколько заголовков', async ({ page }) => {
    await signIn(page, ADMIN)
    await page.goto('/cms/rooms')
    const firstRow = page.locator('[data-testid^="room-row-"]').first()
    await expect(firstRow).toBeVisible({ timeout: 20_000 })

    const headers = await page.locator('thead th').count()
    const cells = await firstRow.locator('td').count()
    // Ячейки «Зона» не было: всё после этажа съезжало под чужой заголовок.
    expect(cells).toBe(headers)
    await expect(firstRow.locator('[data-testid^="room-zone-"]')).toBeVisible()
  })

  test('«Заказы» прямо говорят, что здесь только закрытые', async ({ page }) => {
    await signIn(page, ADMIN)
    await page.goto('/cms/orders')
    await expect(page.getByTestId('cms-orders-scope')).toContainText(/закрытые/i, { timeout: 20_000 })
    await expect(page.getByTestId('cms-orders')).not.toContainText(/после обновления страницы/i)
  })

  test('/cms/styleguide: управляющему по прямому адресу — «раздел закрыт»', async ({ page }) => {
    await signIn(page, RESTAURANT_MANAGER)
    await page.goto('/cms/styleguide')
    await expect(page.getByTestId('cms-section-closed')).toBeVisible({ timeout: 20_000 })
  })

  // Модули в разработке (партия 62-E1): заглушек «модуль в разработке» больше
  // нет, старые адреса ведут на сводку — и администратора, и управляющего.
  for (const path of ['/cms/pms', '/cms/payments', '/cms/mobile-key']) {
    for (const [who, account] of [['администратор', ADMIN], ['управляющий', RESTAURANT_MANAGER]] as const) {
      test(`${path}: ${who} по прямому адресу попадает на сводку`, async ({ page }) => {
        await signIn(page, account)
        await page.goto(path)
        await expect(page).toHaveURL(/\/cms\/dashboard/, { timeout: 20_000 })
        await expect(page.locator('[data-testid^="module-pending-"]')).toHaveCount(0)
      })
    }
  }

  test('порог просрочки: пустое поле уходит как «по умолчанию», а не как ноль', async ({ page, request }) => {
    await signIn(page, ADMIN)
    const token = await request
      .post(`${API}/api/staff/auth/login`, { data: ADMIN, headers: { 'X-Hotel-Subdomain': 'crystal' } })
      .then((r) => r.json())
    const services = await request
      .get(`${API}/api/v1/cms/services`, {
        headers: { Authorization: `Bearer ${token.access}`, 'X-Hotel-Subdomain': 'crystal' },
      })
      .then((r) => r.json())
    const kitchen = services.items.find((s: { code: string }) => s.code === 'kitchen')
    await page.goto(`/cms/services/${kitchen.id}`)
    await page.getByTestId('service-tab-schedule').click()
    const field = page.getByTestId('service-sla').locator('input')
    await expect(field).toBeVisible({ timeout: 20_000 })
    const before = await field.inputValue()

    // Ловим тела запросов и не пропускаем их: стенд не трогаем.
    const sent: Array<Record<string, unknown>> = []
    await page.route('**/api/v1/cms/services/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      sent.push(route.request().postDataJSON())
      await route.abort()
    })
    await field.fill('')
    await field.blur()
    await page.waitForTimeout(1_500)
    // Раньше `Number('')` уходил нулём — и вся доска точки краснела.
    expect(sent.some((body) => body.sla_minutes === 0)).toBeFalsy()
    if (before !== '') expect(sent).toContainEqual({ sla_minutes: null })
  })
})

test.describe('Control: роль «только чтение» не видит кнопок, которые ответят 403', () => {
  test('отели, группы, справочник, команда', async ({ page, request }) => {
    const eyes = await readOnlyAccount(request)
    await signInPlatform(page, eyes)

    await page.goto('/admin?section=fleet')
    await expect(page.getByTestId('admin-fleet-open-crystal')).toBeVisible({ timeout: 30_000 })
    await page.locator('input[type="checkbox"]').nth(1).check().catch(() => undefined)
    await expect(page.getByTestId('admin-fleet-bulkbar')).toHaveCount(0)

    await page.getByTestId('admin-fleet-open-crystal').click()
    await expect(page.getByTestId('admin-hotel')).toBeVisible({ timeout: 20_000 })

    // Карточка открывается на «Обзоре» (партия 62-B); профиль — своя вкладка.

    await page.getByTestId('admin-hotel-tab-profile').click()
    await expect(page.getByTestId('admin-hotel-active')).toHaveCount(0)
    await expect(page.getByTestId('admin-hotel-active-label')).toBeVisible()
    await expect(page.getByTestId('admin-hotel-admin-reset')).toHaveCount(0)
    // Ключ подписи тарифа больше не сырой.
    await expect(page.getByTestId('admin-hotel')).not.toContainText('tariffOwnerOnly')

    // Группы живут в «Отелях» (партия 62-A1): правки групп «только чтению» не видны.
    await page.goto('/admin?section=fleet')
    await expect(page.getByTestId('admin-fleet')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('admin-group-create-open')).toHaveCount(0)
    await expect(page.locator('[data-testid^="admin-group-delete-"]')).toHaveCount(0)
    await expect(page.locator('[data-testid^="admin-group-edit-"]')).toHaveCount(0)

    await page.goto('/admin?section=templates')
    await page.getByTestId('admin-templates-tab-dictionary').click()
    await expect(page.getByTestId('admin-dict-divergence')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid^="admin-dict-reset"]')).toHaveCount(0)
  })
})

test.describe('Control: профиль отеля отправляет только изменённое', () => {
  test('смена пояса не шлёт название и город', async ({ page }) => {
    await signInPlatform(page, PLATFORM)
    await page.goto('/admin?section=fleet')
    await page.getByTestId('admin-fleet-open-crystal').click()
    await expect(page.getByTestId('admin-hotel')).toBeVisible({ timeout: 30_000 })
    // Карточка открывается на «Обзоре» (партия 62-B); профиль — своя вкладка.
    await page.getByTestId('admin-hotel-tab-profile').click()

    let sent: Record<string, unknown> | null = null
    await page.route('**/api/v1/platform/hotels/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      sent = route.request().postDataJSON()
      await route.abort()
    })
    const timezone = page.getByTestId('admin-hotel-timezone-input')
    const was = await timezone.getAttribute('data-value')
    await timezone.click()
    await page
      .locator(`[role="option"]:not([data-value="${was}"])`)
      .first()
      .click()
    await page.getByTestId('admin-hotel-save').click()
    await expect.poll(() => sent).not.toBeNull()
    expect(Object.keys(sent ?? {})).toEqual(['timezone'])
  })
})

test.describe('Control: тумблер модуля шлёт только переключённый модуль', () => {
  test('один щелчок — один модуль, без config', async ({ page }) => {
    await signInPlatform(page, PLATFORM)
    await page.goto('/admin?section=fleet')
    await page.getByTestId('admin-fleet-open-crystal').click()
    await page.getByTestId('admin-hotel-tab-modules').click()

    let sent: Record<string, unknown> | null = null
    let url = ''
    await page.route('**/api/v1/platform/hotels/*/modules/*', async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback()
      sent = route.request().postDataJSON()
      url = route.request().url()
      await route.abort()
    })
    // Весь реестр с прочитанным config затирал намерения остальных модулей
    // и демо-вход, включённый в CMS после загрузки экрана. С 62-E1 адрес
    // называет один модуль, тело — только «включён ли».
    await page.getByTestId('admin-module-toggle-marketing').click()
    await expect.poll(() => sent).not.toBeNull()
    expect(url).toMatch(/\/modules\/marketing$/)
    expect(sent).toEqual({ enabled: expect.any(Boolean) })
  })
})

test.describe('Control: сброс второго фактора участнику', () => {
  test('владелец видит «Сбросить 2FA» у другого, не у себя; сброс — после вопроса', async ({ page, request }) => {
    const eyes = await readOnlyAccount(request)
    // У участника фактор «включён» — подменяем список, стенд не трогаем.
    await page.route('**/api/v1/platform/team?*', async (route) => {
      const res = await route.fetch()
      const body = await res.json()
      for (const row of body.items) row.totp_enabled = true
      await route.fulfill({ response: res, json: body })
    })
    let resetCalled = ''
    await page.route('**/api/v1/platform/team/*/2fa/reset', async (route) => {
      resetCalled = route.request().url()
      await route.abort()
    })
    await signInPlatform(page, PLATFORM)
    await page.goto('/admin?section=team')

    await expect(page.getByTestId(`admin-team-2fa-reset-${eyes.email}`)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId(`admin-team-2fa-reset-${PLATFORM.email}`)).toHaveCount(0)

    await page.getByTestId(`admin-team-2fa-reset-${eyes.email}`).click()
    const ask = page.getByTestId(`admin-team-2fa-reset-confirm-${eyes.email}`)
    await expect(ask).toContainText(/оборвутся|журнал/)
    expect(resetCalled).toBe('')
    await ask.getByTestId(`admin-team-2fa-reset-confirm-${eyes.email}-confirm`).click()
    await expect.poll(() => resetCalled).toContain('/2fa/reset')
  })
})
