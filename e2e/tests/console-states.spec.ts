import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * Отказ не выглядит как загрузка.
 *
 * Было одно условие на все случаи: `if (!data) return <CircularProgress />`.
 * Упавший запрос оставляет `data` неопределённой ровно так же, как ещё не
 * пришедший, — и оператор ждал того, чего не будет: спиннер крутился вечно,
 * без причины и без повтора.
 *
 * Проверяется БРАУЗЕРОМ, а не юнит-тестом: спиннер — это то, что видит
 * человек, и «компонент вернул нужную ветку» не то же самое, что «на экране
 * видно, что случилось».
 */

const PLATFORM = { email: 'platform@itv.local', password: 'platform12345' }

const EMPTY_PAGE = { items: [], total: 0, limit: 100, truncated: false }
const EMPTY_AUDIT = { items: [], total: 0, limit: 100, next_cursor: null }

const SCREENS = [
  { key: 'overview', nav: 'admin-nav-overview', api: ['/overview'] },
  { key: 'fleet', nav: 'admin-nav-fleet', api: ['/fleet'], empty: { items: [], total: 0 } },
  { key: 'modules', nav: 'admin-nav-modules', api: ['/tariffs'], empty: [] },
  // Выдачи консоли приходят оболочкой `{items, total}` — пустой ответ должен
  // быть пустым В ЭТОЙ ФОРМЕ, иначе экран честно покажет отказ разбора, а тест
  // будет думать, что проверяет пустоту.
  { key: 'nodes', nav: 'admin-nav-nodes', api: ['/nodes'], empty: EMPTY_PAGE },
  { key: 'templates', nav: 'admin-nav-templates', api: ['/templates'], empty: EMPTY_PAGE },
  { key: 'team', nav: 'admin-nav-team', api: ['/team'], empty: EMPTY_PAGE },
  { key: 'audit', nav: 'admin-nav-audit', api: ['/audit'], empty: EMPTY_AUDIT },
  { key: 'support', nav: 'admin-nav-support', api: ['/impersonations'], empty: [] },
]

/**
 * Подмена ставится ДО входа: react-query кэширует ответ первой загрузки, и
 * перехват после неё проверял бы кэш, а не экран.
 */
async function serve(ctx: BrowserContext, paths: string[], reply: { status: number; body: string }) {
  await ctx.route('**/api/v1/platform/**', async (route) => {
    const url = route.request().url()
    if (!paths.some((p) => url.includes(`/platform${p}`))) return route.continue()
    // `/audit/actions` — список видов действий для фильтра, а не страница
    // журнала: подменить его оболочкой значит уронить рендер на `.map`,
    // и тест проверял бы уже границу экрана, а не пустое состояние.
    if (url.includes('/audit/actions')) {
      return route.fulfill({ status: reply.status, contentType: 'application/json', body: '[]' })
    }
    return route.fulfill({ status: reply.status, contentType: 'application/json', body: reply.body })
  })
}

async function loginToAdmin(page: Page): Promise<void> {
  await page.goto('/admin')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/admin')
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 30_000 })
}

test.describe('Консоль: отказ виден', () => {
  for (const screen of SCREENS) {
    test(`${screen.key}: 500 показывает ошибку с повтором, а не спиннер`, async ({ browser }) => {
      const ctx = await browser.newContext({ locale: 'ru-RU' })
      await serve(ctx, screen.api, { status: 500, body: '{"detail":"боль"}' })
      const page = await ctx.newPage()
      await loginToAdmin(page)

      await page.getByTestId(screen.nav).click()

      const error = page.getByTestId('state-error')
      await expect(error).toBeVisible({ timeout: 20_000 })
      // Ошибка НАЗЫВАЕТ, что не загрузилось: «не удалось» без предмета —
      // это та же беспомощность, только словами.
      await expect(error).toContainText(/загрузить \S+/)
      await expect(page.getByTestId('state-retry')).toBeVisible()
      // И спиннера рядом нет: две ветки не показываются одновременно.
      await expect(page.locator('main .MuiCircularProgress-root')).toHaveCount(0)

      await ctx.close()
    })
  }

  for (const screen of SCREENS.filter((s) => s.empty !== undefined)) {
    test(`${screen.key}: пустой ответ показывает фразу, а не пустое место`, async ({ browser }) => {
      const ctx = await browser.newContext({ locale: 'ru-RU' })
      await serve(ctx, screen.api, { status: 200, body: JSON.stringify(screen.empty) })
      const page = await ctx.newPage()
      await loginToAdmin(page)

      await page.getByTestId(screen.nav).click()

      const empty = page.getByTestId('state-empty')
      await expect(empty).toBeVisible({ timeout: 20_000 })
      await expect(empty).not.toHaveText('')
      // Главное различие: пустота — это НЕ отказ. Их нельзя перепутать.
      await expect(page.getByTestId('state-error')).toHaveCount(0)

      await ctx.close()
    })
  }

  test('повтор действительно перезапрашивает', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ru-RU' })
    // Сервер «чинится» не после первой попытки, а когда мы этого захотим:
    // react-query сам повторяет упавший запрос, и счётчик попыток тут ничего
    // бы не значил — ошибка не успела бы показаться.
    let failing = true
    let attempts = 0
    await ctx.route('**/api/v1/platform/**', async (route) => {
      const url = route.request().url()
      if (!url.includes('/platform/nodes')) return route.continue()
      attempts += 1
      if (failing) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(EMPTY_PAGE),
      })
    })
    const page = await ctx.newPage()
    await loginToAdmin(page)

    await page.getByTestId('admin-nav-nodes').click()
    await expect(page.getByTestId('state-error')).toBeVisible({ timeout: 20_000 })

    const before = attempts
    failing = false
    await page.getByTestId('state-retry').click()

    await expect(page.getByTestId('state-empty')).toBeVisible({ timeout: 20_000 })
    expect(attempts, 'повтор не сходил на сервер').toBeGreaterThan(before)

    await ctx.close()
  })

  test('ответ неожиданной формы не гасит консоль целиком', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ru-RU' })
    // `{}` вместо сводки роняет рендер. Без границы React снимал всё дерево,
    // и оператор видел белый экран без навигации — уйти можно было только
    // через адресную строку.
    await serve(ctx, ['/overview'], { status: 200, body: '{}' })
    const page = await ctx.newPage()
    await loginToAdmin(page)

    await expect(page.getByTestId('screen-crashed')).toBeVisible({ timeout: 20_000 })
    // Навигация пережила падение — это и есть смысл границы.
    await expect(page.getByTestId('admin-nav-team')).toBeVisible()
    await page.getByTestId('admin-nav-team').click()
    await expect(page.getByTestId('admin-team')).toBeVisible({ timeout: 20_000 })

    await ctx.close()
  })
})
