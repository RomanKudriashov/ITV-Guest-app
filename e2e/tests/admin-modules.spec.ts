import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, PLATFORM, signInPlatform } from './helpers'

/**
 * МОДУЛИ БЕЗ ТАРИФОВ (партия 62-E1).
 *
 * Меню Control целиком, каталог «Модули» (блоки, список, таблица, поиск и
 * фильтры в адресе), страница модуля, вкладка модулей отеля с одним
 * выключателем, старые адреса разделов. Сервер — `test_modules_62e1.py`.
 *
 * Стенд общий: что тест включил, то он и выключает.
 */

const MENU = [
  ['overview', 'Сводка'],
  ['fleet', 'Отели'],
  ['modules', 'Модули'],
  ['templates', 'Справочники'],
  ['team', 'Команда'],
  ['audit', 'Журнал действий'],
  ['security', 'Безопасность'],
] as const

const CODES = /\b(room_control|marketing|pms|payment|mobile_key|native_app|analytics_level|multi_restaurant|extra_languages)\b/

async function platform(request: APIRequestContext) {
  const access = (await (await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })).json()).access as string
  const headers = { Authorization: `Bearer ${access}` }
  const fleet = await (await request.get(`${API}/api/v1/platform/fleet?search=crystal&origin=all`, { headers })).json()
  const crystal = (fleet.items as { id: string; subdomain: string }[]).find((row) => row.subdomain === 'crystal')!
  return { headers, crystalId: crystal.id }
}

async function marketingOn(request: APIRequestContext, headers: Record<string, string>, hotelId: string): Promise<boolean> {
  const body = await (await request.get(`${API}/api/v1/platform/hotels/${hotelId}/modules`, { headers })).json()
  return Boolean((body.modules as { code: string; is_enabled: boolean }[]).find((m) => m.code === 'marketing')?.is_enabled)
}

const items = (page: Page) => page.locator('[data-testid^="admin-modules-item-"]')

test.describe('Control: меню и старые адреса', () => {
  test('меню ровно: Сводка · Отели · Модули · Справочники · Команда · Журнал действий · Безопасность', async ({ page }) => {
    await signInPlatform(page, PLATFORM)
    await page.goto('/admin?section=overview')
    const nav = page.locator('a[data-testid^="admin-nav-"]')
    await expect(nav.first()).toBeVisible({ timeout: 20_000 })
    const keys = await nav.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')!.replace('admin-nav-', '')))
    expect(keys).toEqual(MENU.map(([key]) => key))
    for (const [key, label] of MENU) {
      await expect(page.getByTestId(`admin-nav-${key}`)).toContainText(label)
    }
    await expect(page.getByTestId('admin-nav-publications')).toHaveCount(0)
  })

  test('старый адрес «Публикации» ведёт в «Модули», «Модули и тарифы» — в каталог', async ({ page }) => {
    await signInPlatform(page, PLATFORM)
    await page.goto('/admin?section=publications')
    await expect(page).toHaveURL(/section=modules/, { timeout: 20_000 })
    await expect(page.getByTestId('admin-modules')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('admin-crumb')).toHaveText('Модули')

    await page.goto('/admin?section=modules')
    await expect(page.getByTestId('admin-modules-item-room_control')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('admin-tariff-row-business')).toHaveCount(0)
  })
})

test.describe('Control: каталог модулей', () => {
  test('три вида, поиск и фильтры в адресе, без кодов на экране', async ({ page }) => {
    await signInPlatform(page, PLATFORM)
    await page.goto('/admin?section=modules')
    await expect(items(page)).toHaveCount(9, { timeout: 20_000 })
    await expect(page.getByTestId('admin-modules')).not.toContainText(CODES)
    await expect(page.getByTestId('admin-modules-item-pms')).toContainText('в разработке')
    await expect(page.getByTestId('admin-modules-item-room_control')).toContainText('работает')

    await page.getByTestId('admin-modules-view-list').click()
    await expect(page).toHaveURL(/view=list/)
    await expect(items(page)).toHaveCount(9)
    await page.getByTestId('admin-modules-view-table').click()
    await expect(page).toHaveURL(/view=table/)
    await expect(page.getByTestId('admin-modules-table')).toBeVisible()
    await expect(page.getByTestId('admin-modules')).not.toContainText(CODES)

    // Фильтр «в разработке» — чипом и в адресе; F5 его не теряет.
    await page.getByTestId('admin-hotels-facet-mstate').click()
    await page.getByTestId('admin-hotels-option-mstate-dev').click()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/mstate=dev/)
    await expect(items(page)).toHaveCount(7)
    await page.reload()
    await expect(items(page)).toHaveCount(7, { timeout: 20_000 })
    await expect(page.getByTestId('admin-hotels-chip-mstate-dev')).toBeVisible()

    // «Нужно подключение» поверх «в разработке»: PMS, оплата, ключ.
    await page.getByTestId('admin-hotels-facet-need').click()
    await page.getByTestId('admin-hotels-option-need-yes').click()
    await page.keyboard.press('Escape')
    await expect(items(page)).toHaveCount(3)

    await page.getByTestId('admin-hotels-reset').click()
    await expect(items(page)).toHaveCount(9)
    await page.getByTestId('admin-fleet-search').fill('свет')
    await expect(page).toHaveURL(/search=/)
    await expect(items(page)).toHaveCount(1)
    await expect(page.getByTestId('admin-modules-item-room_control')).toBeVisible()
  })

  test('страница модуля: что открывает, умолчания, отели, журнал; «← Все модули» возвращает фильтры', async ({ page }) => {
    await signInPlatform(page, PLATFORM)
    await page.goto('/admin?section=modules&view=list&mstate=ready')
    await page.getByTestId('admin-modules-item-room_control').click()
    await expect(page).toHaveURL(/module=room_control/)
    const card = page.getByTestId('admin-module-page')
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(card).toContainText('Что открывает')
    await expect(card).toContainText('Вход гостя без PIN (демо)')
    await expect(page.getByTestId('admin-module-hotel-crystal')).toBeVisible()

    // Поиск отелей — на сервере, в адресе.
    await page.getByTestId('admin-fleet-search').fill('crystal')
    await expect(page).toHaveURL(/search=crystal/)
    await expect(page.getByTestId('admin-module-hotel-crystal')).toBeVisible({ timeout: 20_000 })
    const shown = await page.locator('[data-testid^="admin-module-hotel-"][data-enabled]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
    expect(shown.every((id) => id!.includes('crystal'))).toBeTruthy()

    await page.getByTestId('admin-module-back').click()
    await expect(page).toHaveURL(/view=list/)
    await expect(page).toHaveURL(/mstate=ready/)
    await expect(page).not.toHaveURL(/module=/)
    await expect(items(page)).toHaveCount(2, { timeout: 20_000 })
  })

  test('модуль в разработке: пометка, у выключенных отелей выключателя нет', async ({ page }) => {
    await signInPlatform(page, PLATFORM)
    await page.goto('/admin?section=modules&module=pms')
    await expect(page.getByTestId('admin-module-dev-note')).toBeVisible({ timeout: 20_000 })
    const row = page.getByTestId('admin-module-hotel-crystal')
    await expect(row).toHaveAttribute('data-enabled', 'false')
    await expect(page.getByTestId('admin-module-hotel-toggle-crystal')).toHaveCount(0)
    await expect(row).toContainText('включить пока нельзя')
  })
})

test.describe('Control: модули отеля', () => {
  test('один выключатель — один модуль, журнал модуля это видит', async ({ page, request }) => {
    const { headers, crystalId } = await platform(request)
    const was = await marketingOn(request, headers, crystalId)
    const set = (enabled: boolean) =>
      request.put(`${API}/api/v1/platform/hotels/${crystalId}/modules/marketing`, { data: { enabled }, headers })
    await set(false)
    try {
      await signInPlatform(page, PLATFORM)
      await page.goto(`/admin?section=fleet&hotel=${crystalId}&tab=modules`)
      await expect(page.getByTestId('admin-hotel-modules')).toBeVisible({ timeout: 20_000 })

      // Модуль в разработке — с пометкой, без выключателя, без кодов на экране.
      await expect(page.getByTestId('admin-module-pms')).toHaveAttribute('data-status', 'dev')
      await expect(page.getByTestId('admin-module-toggle-pms')).toHaveCount(0)
      await expect(page.getByTestId('admin-hotel-modules')).not.toContainText(CODES)
      // «?» у каждого выключателя.
      const toggles = await page.locator('[data-testid^="admin-module-toggle-"]').count()
      expect(toggles).toBeGreaterThan(0)
      for (const code of ['marketing', 'room_control']) {
        const block = page.getByTestId(`admin-module-${code}`)
        await expect(block.getByRole('button', { name: /подробнее|more/i }).first()).toBeVisible()
      }

      const bodies: unknown[] = []
      const urls: string[] = []
      page.on('request', (r) => {
        if (r.method() === 'PUT' && r.url().includes('/modules/')) {
          urls.push(r.url())
          bodies.push(r.postDataJSON())
        }
      })
      await page.getByTestId('admin-module-toggle-marketing').click()
      await expect(page.getByTestId('admin-module-state-marketing')).toHaveText('работает', { timeout: 20_000 })
      expect(urls).toHaveLength(1)
      expect(urls[0]).toMatch(/\/modules\/marketing$/)
      expect(bodies[0]).toEqual({ enabled: true })

      // Журнал модуля: «Кристалл: включён».
      await page.getByTestId('admin-module-about-marketing').click()
      await expect(page).toHaveURL(/section=modules.*module=marketing|module=marketing.*section=modules/)
      await expect(page.getByTestId('admin-module-journal-row').first()).toContainText('включён', { timeout: 20_000 })
    } finally {
      await set(was)
    }
  })

  test('заготовку не включить и запросом: 409 module_in_development', async ({ request }) => {
    const { headers, crystalId } = await platform(request)
    const refused = await request.put(`${API}/api/v1/platform/hotels/${crystalId}/modules/pms`, {
      data: { enabled: true },
      headers,
    })
    expect(refused.status()).toBe(409)
    expect((await refused.json()).code).toBe('module_in_development')
  })

  test('нужное подключение не заведено — карточка говорит и ведёт в «Подключения»', async ({ page, request }) => {
    const { headers, crystalId } = await platform(request)
    const readiness = await (await request.get(`${API}/api/v1/platform/hotels/${crystalId}/readiness`, { headers })).json()
    const broken = (readiness.problems as { code: string; params: { module?: string } }[]).some(
      (p) => p.code === 'module_without_connection' && p.params.module === 'room_control',
    )
    // Условие задаём явно: если у «Кристалла» коннектор есть, подменяем ответ
    // готовности — стенд не трогаем.
    if (!broken) {
      await page.route(`**/api/v1/platform/hotels/${crystalId}/readiness`, async (route) => {
        const res = await route.fetch()
        const body = await res.json()
        body.problems = [
          ...body.problems,
          { code: 'module_without_connection', key: 'module_without_connection:room_control', severity: 'bad', fix: 'connections', count: 1, title: '', params: { module: 'room_control', needs: 'grms' } },
        ]
        await route.fulfill({ response: res, json: body })
      })
      await page.route(`**/api/v1/platform/hotels/${crystalId}/modules`, async (route) => {
        const res = await route.fetch()
        const body = await res.json()
        for (const m of body.modules) if (m.code === 'room_control') m.is_enabled = true
        await route.fulfill({ response: res, json: body })
      })
    }
    await signInPlatform(page, PLATFORM)
    await page.goto(`/admin?section=fleet&hotel=${crystalId}&tab=modules`)
    const connection = page.getByTestId('admin-module-connection-room_control')
    await expect(connection).toHaveAttribute('data-missing', 'true', { timeout: 20_000 })
    await expect(page.getByTestId('admin-module-state-room_control')).toHaveText('включён, но не работает')
    await page.getByTestId('admin-module-connect-room_control').click()
    await expect(page).toHaveURL(/tab=connections/)
  })
})
