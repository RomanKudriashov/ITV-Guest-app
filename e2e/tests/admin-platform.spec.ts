import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, apiHeaders, apiToken, ADMIN } from './helpers'

/**
 * R6: NaviRoom Control /admin.
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

    // Фильтр «Отключён» не должен показывать работающий отель; крестик на чипе снимает фильтр.
    await page.getByTestId('admin-hotels-facet-state').click()
    await page.getByTestId('admin-hotels-option-state-disabled').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId(`admin-fleet-row-${DEMO}`)).toBeHidden({ timeout: 15_000 })
    await page.getByTestId('admin-hotels-chip-state-disabled').getByRole('button').click()
    await expect(page.getByTestId(`admin-fleet-row-${DEMO}`)).toBeVisible({ timeout: 15_000 })
  })

  test('вкладка модулей отеля: заготовку не включить, старые ключи тарифа ведут сюда', async ({ page }) => {
    // Тарифов нет (партия 62-E1): «Тариф и лимиты» ушли, на вкладке — только
    // модули, по одному выключателю.
    await loginToAdmin(page)
    await page.getByTestId('admin-nav-fleet').click()
    await page.getByTestId('admin-fleet-search').fill(DEMO)
    await page.getByTestId(`admin-fleet-open-${DEMO}`).click()
    await expect(page.getByTestId('admin-hotel')).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('admin-hotel-tab-modules').click()
    await expect(page.getByTestId('admin-hotel-modules')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('admin-module-room_control')).toHaveAttribute('data-status', 'ready')
    await expect(page.getByTestId('admin-module-toggle-room_control')).toBeVisible()
    // Модуль в разработке — с пометкой и без выключателя.
    await expect(page.getByTestId('admin-module-pms')).toHaveAttribute('data-status', 'dev')
    await expect(page.getByTestId('admin-module-state-pms')).toHaveText('в разработке')
    await expect(page.getByTestId('admin-module-toggle-pms')).toHaveCount(0)
    await expect(page.getByTestId('admin-hotel-usage')).toHaveCount(0)
    await expect(page.getByTestId('admin-tariff-select')).toHaveCount(0)

    // Старый ключ не ломается: `?tab=usage` и `?tab=tariff` приводят к модулям.
    for (const key of ['usage', 'tariff']) {
      const old = new URL(page.url())
      old.searchParams.set('tab', key)
      await page.goto(old.toString())
      await expect(page.getByTestId('admin-hotel-modules')).toBeVisible({ timeout: 15_000 })
    }

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
    await request.put(`${API}/api/v1/platform/hotels/${hotelId}/modules/marketing`, {
      data: { enabled: false },
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
    // Тарифов нет (62-E1): состояние — «работает» или «выключен».
    const marketing = page.getByTestId('admin-module-state-marketing')
    await expect(marketing).toHaveText('работает', { timeout: 15_000 })

    // И раздел появился в навигации отеля. Это и есть механизм: без модуля
    // отель не видит ни одного его экрана.
    await expect(async () => {
      expect(await navKeys()).toContain('marketing')
    }).toPass({ timeout: 15_000 })

    // Выключаем обратно — и раздел уходит из навигации.
    await page.getByTestId('admin-module-toggle-marketing').click()
    await expect(marketing).toHaveText('выключен', { timeout: 15_000 })
    await expect(async () => {
      expect(await navKeys()).not.toContain('marketing')
    }).toPass({ timeout: 15_000 })

    // Возвращаем как было — стенд общий.
    await request.put(`${API}/api/v1/platform/hotels/${hotelId}/modules/marketing`, {
      data: { enabled: false },
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
      // Журнал приходит оболочкой: страница записей плюс курсор и общее число.
      .then((page) => page.items)
    const entered = (audit as { action: string; payload: Record<string, unknown> }[]).find(
      (row) => row.action === 'impersonation.started' && row.payload.reason === reason,
    )
    expect(entered, 'вход в отель обязан быть в аудите с причиной').toBeTruthy()

    await page.getByTestId('admin-nav-audit').click()
    await expect(page.getByTestId('admin-audit')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('admin-audit-impersonation.started').first()).toBeVisible()
  })
})

test.describe('Реестры платформы', () => {
  test('модули, узлы, команда и шаблоны открываются с данными', async ({ page }) => {
    await loginToAdmin(page)

    await page.getByTestId('admin-nav-modules').click()
    await expect(page.getByTestId('admin-modules')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('admin-modules-item-room_control')).toBeVisible()

    // «On-premise» ушёл в карточку отеля; старый адрес ведёт в «Отели» с
    // фильтром «не на связи» (партия 62-B).
    await page.goto('/admin?section=nodes')
    await expect(page).toHaveURL(/section=fleet.*link=silent|link=silent.*section=fleet/, { timeout: 15_000 })

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
