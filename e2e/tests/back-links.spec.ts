import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, HOTEL, PLATFORM, apiHeaders, apiToken, signIn } from './helpers'

/**
 * «← НАЗАД» НА ВСЕХ ВНУТРЕННИХ ЭКРАНАХ (партия 56).
 *
 * Правило: возврат — ссылка (`<a href>`) с ИМЕНЕМ родителя («← Сервисы»,
 * «← Меню «Панорамы»», «← Доска», «← Отели»), ведёт по карте маршрутов
 * (`app/backMap.ts`), а не по истории браузера. Поэтому каждый экран здесь
 * открывается ПРЯМЫМ заходом по адресу — истории нет, а родитель известен.
 *
 * На стенде ничего не записывается: только чтение API и переходы.
 */

const ROOT_PORT = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5183').port || '5183'
const ROOT = `http://guest.localhost:${ROOT_PORT}`

type Node = { id: string; service_id?: string | null; children?: Node[] }
const walk = (nodes: Node[]): Node[] => nodes.flatMap((node) => [node, ...walk(node.children ?? [])])

async function serviceCategory(request: APIRequestContext): Promise<{ categoryId: string; serviceId: string }> {
  const token = await apiToken(request, ADMIN)
  const tree = (await (
    await request.get(`${API}/api/v1/cms/categories?all_types=1`, { headers: apiHeaders(token) })
  ).json()) as Node[]
  const category = walk(tree).find((row) => row.service_id)
  expect(category, 'на стенде нет раздела меню с заведением').toBeTruthy()
  return { categoryId: category!.id, serviceId: category!.service_id! }
}

async function expectBack(page: Page, testId: string, label: RegExp, href: RegExp) {
  const back = page.getByTestId(testId)
  await expect(back).toBeVisible({ timeout: 20_000 })
  await expect(back).toHaveText(label)
  await expect(back).toHaveAttribute('href', href)
  return back
}

test.describe('панель отеля', () => {
  test('заведение: «← Сервисы» ведёт в список сервисов', async ({ page, request }) => {
    const { serviceId } = await serviceCategory(request)
    await signIn(page, ADMIN)
    await page.goto(`/cms/services/${serviceId}`)
    const back = await expectBack(page, 'service-back', /^Сервисы$/, /\/services$/)
    await back.click()
    await expect(page).toHaveURL(/\/services$/)
  })

  test('раздел меню: прямой заход без ?service_id знает своё заведение', async ({ page, request }) => {
    const { categoryId, serviceId } = await serviceCategory(request)
    await signIn(page, ADMIN)
    await page.goto(`/cms/menu/categories/${categoryId}`)
    const back = await expectBack(page, 'category-back-button', /^Меню «.+»$/, new RegExp(`/services/${serviceId}$`))
    await back.click()
    await expect(page.getByTestId('cms-service-workspace')).toBeVisible({ timeout: 20_000 })
  })

  test('новый раздел: заведение из адреса, без него — «← Сервисы»', async ({ page, request }) => {
    const { serviceId } = await serviceCategory(request)
    await signIn(page, ADMIN)
    await page.goto(`/cms/menu/categories/new?service_id=${serviceId}`)
    await expectBack(page, 'category-back-button', /^Меню/, new RegExp(`/services/${serviceId}$`))
    await page.goto('/cms/menu/categories/new')
    await expectBack(page, 'category-back-button', /^Сервисы$/, /\/services$/)
  })

  test('меню заведения передаёт service_id в редактор раздела', async ({ page, request }) => {
    const { serviceId } = await serviceCategory(request)
    await signIn(page, ADMIN)
    await page.goto(`/cms/services/${serviceId}`)
    await page.getByTestId('add-category-button').click()
    await expect(page).toHaveURL(new RegExp(`/menu/categories/new\\?service_id=${serviceId}`))
    await expectBack(page, 'category-back-button', /^Меню/, new RegExp(`/services/${serviceId}$`))
  })

  for (const [path, testId] of [
    ['/cms/profile', 'profile-back'],
    ['/cms/styleguide', 'styleguide-back'],
  ] as const) {
    test(`${path}: «← Дашборд» — домой по правам`, async ({ page }) => {
      await signIn(page, ADMIN)
      await page.goto(path)
      await expectBack(page, testId, /^Дашборд$/, /\/dashboard$/)
    })
  }
})

test.describe('трекер', () => {
  test('«Мои точки»: «← Доска»', async ({ page }) => {
    // У администратора все активные точки — экран «Мои точки» ему есть.
    await signIn(page, ADMIN)
    await page.goto('/tracker/my-points')
    await expectBack(page, 'my-points-back', /^Доска$/, /\/tracker$/)
  })

  test('доска сохраняет фильтр: открыть заказ по адресу и вернуться — фильтр на месте', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)
    const headers = apiHeaders(token)
    const points = (await (await request.get(`${API}/api/v1/tracker/points`, { headers })).json()).points as Array<{
      code: string
    }>
    let orderId: string | undefined
    for (const point of points) {
      const board = await (
        await request.get(`${API}/api/v1/tracker/orders?point=${point.code}&scope=history`, { headers })
      ).json()
      orderId = (board.columns ?? []).flatMap((column: { orders: Array<{ id: string }> }) => column.orders)[0]?.id
      if (orderId) break
    }
    test.skip(!orderId, 'в истории стенда нет ни одного заказа')

    await signIn(page, ADMIN)
    await page.goto('/tracker')
    await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('tracker-filters-toggle').click()
    await page.getByTestId('tracker-filter-mine').click()
    await expect(page).toHaveURL(/[?&]mine=1/)
    // Доска запоминает фильтр эффектом после смены адреса — ждём записи, иначе
    // под нагрузкой прямой заход опережает её (красная в общем прогоне 56).
    await expect
      .poll(() => page.evaluate(() => window.sessionStorage.getItem('itv.tracker.boardSearch') ?? ''))
      .toMatch(/mine=1/)

    // Прямой заход по адресу заказа (как из истории или из сообщения).
    await page.goto(`/tracker/order/${orderId}`)
    const back = await expectBack(page, 'tracker-detail-close', /^Доска$/, /\/tracker\?(.*&)?mine=1/)
    await back.click()
    await expect(page).toHaveURL(/\/tracker\?(.*&)?mine=1/)
    await page.getByTestId('tracker-filters-toggle').click()
    await expect(page.getByTestId('tracker-filter-mine')).toBeChecked()

    // Запрос доски в адресе заказа — главный: он и уходит в «← Доска».
    await page.goto(`/tracker/order/${orderId}?overdue=1`)
    await expectBack(page, 'tracker-detail-close', /^Доска$/, /\/tracker\?overdue=1$/)
  })

  test('ресепшен: «← Доска», на узком экране из диалога — «← Диалоги»', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)
    const threads = (await (
      await request.get(`${API}/api/v1/tracker/chat/threads`, { headers: apiHeaders(token) })
    ).json()) as { items?: Array<{ id: string }> }
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, ADMIN)
    await page.goto('/tracker/desk')
    await expectBack(page, 'desk-to-board', /^Доска$/, /\/tracker(\?.*)?$/)

    const threadId = threads.items?.[0]?.id
    test.skip(!threadId, 'на стенде нет ни одного диалога')
    await page.goto(`/tracker/desk?t=${threadId}`)
    const back = await expectBack(page, 'desk-back', /^Диалоги$/, /\/tracker\/desk$/)
    await back.click()
    await expect(page).toHaveURL(/\/tracker\/desk$/)
    await expect(page.getByTestId('desk-back')).toHaveCount(0)
  })
})

test('NaviRoom Control, карточка отеля: одна «← Отели», с фильтрами флота', async ({ page }) => {
  await page.goto(`${ROOT}/admin`)
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 30_000 })

  await page.goto(`${ROOT}/admin?section=fleet`)
  await page.getByTestId('admin-fleet-search').fill(HOTEL)
  await expect(page).toHaveURL(new RegExp(`search=${HOTEL}`), { timeout: 15_000 })
  await page.getByTestId(`admin-fleet-open-${HOTEL}`).click()
  await expect(page.getByTestId('admin-hotel')).toBeVisible({ timeout: 20_000 })

  // Один выход из карточки: ссылка «← Отели» слева сверху, второй кнопки нет.
  await expect(page.getByTestId('admin-hotel-back')).toHaveCount(1)
  await expect(page.getByTestId('admin-hotel').getByRole('button', { name: /К списку/ })).toHaveCount(0)
  const back = await expectBack(page, 'admin-hotel-back', /^Отели$/, new RegExp(`/admin\\?(?=.*section=fleet)(?=.*search=${HOTEL})`))
  await expect(back).not.toHaveAttribute('href', /hotel=/)

  // Крошка в шапке называет отель.
  await expect(page.getByTestId('admin-crumb-hotel')).toHaveText(/^Отель «.+»$/)

  await back.click()
  await expect(page.getByTestId(`admin-fleet-row-${HOTEL}`)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('admin-fleet-search')).toHaveValue(HOTEL)

  // Прямой заход в карточку (без истории) — родитель тот же.
  await page.goto(`${ROOT}/admin?section=fleet&hotel=${await hotelIdFromUrl(page)}`)
  await expectBack(page, 'admin-hotel-back', /^Отели$/, /\/admin\?section=fleet$/)
})

/** id отеля — из ссылки строки флота (адрес карточки несёт его в `?hotel=`). */
async function hotelIdFromUrl(page: Page): Promise<string> {
  await page.getByTestId(`admin-fleet-open-${HOTEL}`).click()
  await expect(page).toHaveURL(/hotel=/, { timeout: 15_000 })
  const id = new URL(page.url()).searchParams.get('hotel')!
  return id
}
