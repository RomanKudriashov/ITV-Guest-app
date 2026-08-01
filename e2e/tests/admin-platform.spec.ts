import { expect, test, type Page } from '@playwright/test'

import { API, apiHeaders, apiToken, ADMIN } from './helpers'

/**
 * R6: корневая админка /admin.
 *
 * Главное, что здесь проверяется, — что админка УПРАВЛЯЕТ, а не показывает:
 * тумблер модуля меняет навигацию CMS живого отеля, вход в отель попадает в
 * аудит, флот фильтрует настоящие данные. Экраны, которые красиво выглядят и
 * ничего не меняют, такой тест не пройдёт.
 */

const PLATFORM = { email: 'platform@itv.local', password: 'platform12345' }
const DEMO = 'crystal'

async function loginToAdmin(page: Page): Promise<void> {
  await page.goto('/admin')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/admin')
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 15_000 })
}

async function platformToken(request: Parameters<typeof apiToken>[0]): Promise<string> {
  const resp = await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
  expect(resp.ok(), await resp.text()).toBeTruthy()
  return (await resp.json()).access
}

test.describe('Сводка и флот', () => {
  test('владелец видит сводку и находит отель поиском', async ({ page }) => {
    await loginToAdmin(page)

    await expect(page.getByTestId('admin-overview')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('admin-kpi-hotels')).toBeVisible()
    await expect(page.getByTestId('admin-kpi-orders')).toBeVisible()
    await expect(page.getByTestId('admin-health')).toBeVisible()

    await page.getByTestId('admin-nav-fleet').click()
    await expect(page.getByTestId('admin-fleet')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('admin-fleet-search').fill(DEMO)
    await expect(page.getByTestId(`admin-fleet-row-${DEMO}`)).toBeVisible({ timeout: 15_000 })

    // Фильтр «Отключённые» не должен показывать активный отель.
    await page.getByTestId('admin-fleet-filter-disabled').click()
    await expect(page.getByTestId(`admin-fleet-row-${DEMO}`)).toBeHidden({ timeout: 15_000 })
    await page.getByTestId('admin-fleet-filter-active').click()
    await expect(page.getByTestId(`admin-fleet-row-${DEMO}`)).toBeVisible({ timeout: 15_000 })
  })

  test('карточка отеля показывает использование против лимитов', async ({ page, request }) => {
    // Ставим тариф с малыми лимитами, чтобы превышение было настоящим, а не
    // нарисованным: у демо-отеля шесть сервисов, у standard лимит один.
    const token = await platformToken(request)
    const fleet = await request
      .get(`${API}/api/v1/platform/fleet?search=${DEMO}&origin=all`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((r) => r.json())
    const hotelId = fleet.items[0].id
    await request.put(`${API}/api/v1/platform/hotels/${hotelId}/tariff`, {
      data: { tariff: 'standard', acknowledge_downgrade: true },
      headers: { Authorization: `Bearer ${token}` },
    })

    await loginToAdmin(page)
    await page.getByTestId('admin-nav-fleet').click()
    await page.getByTestId('admin-fleet-search').fill(DEMO)
    await page.getByTestId(`admin-fleet-open-${DEMO}`).click()
    await expect(page.getByTestId('admin-hotel')).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('admin-hotel-tab-usage').click()
    await expect(page.getByTestId('admin-hotel-usage')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('admin-usage-over-services')).toBeVisible()

    // Поддомен не редактируется — это ключ тенанта, напечатанный на QR.
    await page.getByTestId('admin-hotel-tab-profile').click()
    await expect(page.getByTestId('admin-hotel')).toContainText(DEMO)
  })
})

test.describe('Модули управляют CMS', () => {
  test.slow()

  test('тумблер модуля в админке меняет навигацию CMS отеля', async ({ page, request }) => {
    const platform = await platformToken(request)
    const fleet = await request
      .get(`${API}/api/v1/platform/fleet?search=${DEMO}&origin=all`, {
        headers: { Authorization: `Bearer ${platform}` },
      })
      .then((r) => r.json())
    const hotelId = fleet.items[0].id

    const staff = await apiToken(request, ADMIN)
    const navKeys = async (): Promise<string[]> => {
      const nav = (await request
        .get(`${API}/api/cms/navigation`, { headers: apiHeaders(staff) })
        .then((r) => r.json())) as { groups: { items: { key: string }[] }[] }
      return nav.groups.flatMap((group) => group.items.map((item) => item.key))
    }

    // Приводим к известному состоянию: маркетинг выключен.
    await request.put(`${API}/api/v1/platform/hotels/${hotelId}/modules`, {
      data: { modules: [{ code: 'marketing', is_enabled: false }] },
      headers: { Authorization: `Bearer ${platform}` },
    })
    expect(await navKeys()).not.toContain('marketing')

    // Включаем ТУМБЛЕРОМ в интерфейсе — проверяем продукт, а не ручку.
    await loginToAdmin(page)
    await page.getByTestId('admin-nav-fleet').click()
    await page.getByTestId('admin-fleet-search').fill(DEMO)
    await page.getByTestId(`admin-fleet-open-${DEMO}`).click()
    await page.getByTestId('admin-hotel-tab-modules').click()
    await expect(page.getByTestId('admin-hotel-modules')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('admin-module-toggle-marketing').click()
    await expect(page.getByTestId('admin-module-override-marketing')).toBeVisible({ timeout: 15_000 })

    // И раздел появился в навигации отеля. Это и есть механизм: без модуля
    // отель не видит ни одного его экрана.
    await expect(async () => {
      expect(await navKeys()).toContain('marketing')
    }).toPass({ timeout: 15_000 })

    // Возвращаем как было — стенд общий.
    await request.put(`${API}/api/v1/platform/hotels/${hotelId}/modules`, {
      data: { modules: [{ code: 'marketing', is_enabled: false }] },
      headers: { Authorization: `Bearer ${platform}` },
    })
  })
})

test.describe('Вход в отель', () => {
  test('вход требует причины и попадает в аудит', async ({ page, request }) => {
    const platform = await platformToken(request)
    const fleet = await request
      .get(`${API}/api/v1/platform/fleet?search=${DEMO}&origin=all`, {
        headers: { Authorization: `Bearer ${platform}` },
      })
      .then((r) => r.json())
    const hotelId = fleet.items[0].id

    await loginToAdmin(page)
    await page.getByTestId('admin-nav-fleet').click()
    await page.getByTestId('admin-fleet-search').fill(DEMO)
    await page.getByTestId(`admin-fleet-open-${DEMO}`).click()
    await expect(page.getByTestId('admin-hotel')).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('admin-hotel-enter').click()
    await expect(page.getByTestId('admin-enter-dialog')).toBeVisible()

    // Без причины войти нельзя: журнал без «зачем» не годится для разбора.
    await expect(page.getByTestId('admin-enter-submit')).toBeDisabled()

    const reason = `E2E проверка входа ${Date.now().toString(36)}`
    await page.getByTestId('admin-enter-reason').fill(reason)
    await page.getByTestId('admin-enter-submit').click()

    // Выдан доступ с таймером — он тикает на глазах, а не висит бессрочно.
    await expect(page.getByTestId('admin-enter-granted')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('admin-enter-timer')).toContainText(/\d+:\d\d/)
    await expect(page.getByTestId('admin-enter-audited')).toBeVisible()
    // Закрываем диалог: пока он открыт, навигация под ним недоступна.
    await page.getByTestId('admin-enter-granted').getByRole('button', { name: /Готово|Done/ }).click()

    // И запись есть в аудите платформы.
    const audit = await request
      .get(`${API}/api/v1/platform/audit?limit=50`, {
        headers: { Authorization: `Bearer ${platform}` },
      })
      .then((r) => r.json())
    const entered = (audit as { action: string; payload: Record<string, unknown> }[]).find(
      (row) => row.action === 'platform.hotel.entered' && row.payload.reason === reason,
    )
    expect(entered, 'вход в отель обязан быть в аудите с причиной').toBeTruthy()

    await page.getByTestId('admin-nav-audit').click()
    await expect(page.getByTestId('admin-audit')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('admin-audit-platform.hotel.entered').first()).toBeVisible()
  })
})

test.describe('Реестры платформы', () => {
  test('модули и тарифы, узлы, команда и шаблоны открываются с данными', async ({ page }) => {
    await loginToAdmin(page)

    await page.getByTestId('admin-nav-modules').click()
    await expect(page.getByTestId('admin-modules')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('admin-tariff-row-business')).toBeVisible()

    await page.getByTestId('admin-nav-nodes').click()
    await expect(page.getByTestId('admin-nodes')).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('admin-nav-team').click()
    await expect(page.getByTestId('admin-team')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId(`admin-team-row-${PLATFORM.email}`)).toBeVisible()
    // 2FA у человека с доступом ко всем отелям — состояние, на которое смотрят.
    await expect(page.getByTestId(`admin-team-2fa-${PLATFORM.email}`)).toBeVisible()

    await page.getByTestId('admin-nav-templates').click()
    await expect(page.getByTestId('admin-templates')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('admin-template-resort')).toBeVisible()
    await page.getByTestId('admin-templates-tab-dictionary').click()
    await expect(page.getByTestId('admin-dict-allergen-gluten')).toBeVisible({ timeout: 15_000 })
  })

  test('отель заводится из шаблона со своими сервисами', async ({ page }) => {
    const sub = `tpl${Date.now().toString().slice(-9)}`
    await loginToAdmin(page)
    await page.getByTestId('admin-nav-fleet').click()
    await page.getByTestId('admin-create-open').click()
    await page.getByTestId('admin-create-name').fill(`Шаблонный ${sub}`)
    await page.getByTestId('admin-create-subdomain').fill(sub)
    await page.getByTestId('admin-create-admin-email').fill(`admin@${sub}.test`)
    await page.getByTestId('admin-create-template-resort').click()
    await page.getByTestId('admin-create-submit').click()

    // Шаблон развернулся: у отеля сразу есть заведения, а не пустая витрина.
    await expect(page.getByTestId('admin-created-services')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('admin-created-services')).toContainText(/spa|pool/)
    await page.getByTestId('admin-created-done').click()

    // Отель убирается глобальным teardown — снимок стенда сделан до прогона.
  })
})

test.describe('Узкий экран', () => {
  test('на телефоне разделы админки достижимы через шторку', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginToAdmin(page)

    // До этого навигации на телефоне не было ВОВСЕ: панель скрывалась, а
    // замены не появилось — разделы были недостижимы.
    await page.getByTestId('admin-nav-toggle').click()
    await expect(page.getByTestId('admin-nav-drawer')).toBeVisible()

    await page.getByTestId('admin-nav-drawer').getByTestId('admin-nav-team').click()
    await expect(page.getByTestId('admin-team')).toBeVisible({ timeout: 15_000 })
    // Шторка закрывается за собой, а не остаётся поверх открытого раздела.
    await expect(page.getByTestId('admin-nav-drawer')).toBeHidden()
  })
})
