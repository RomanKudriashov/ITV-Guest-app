import { expect, test, type BrowserContext, type Page } from '@playwright/test'

import { ADMIN } from './helpers'

/**
 * CMS отеля и трекер: отказ не врёт и не светит внутренностями.
 *
 * Две разные болезни одного экрана.
 *
 * ПЕРВАЯ — ноль вместо отказа. `services.data ?? []` превращал несостоявшийся
 * ответ в пустой список, а пустой список — в честный на вид ноль: «Заведений
 * на витрине 0». Спиннер хотя бы говорит «жду»; ноль утверждает факт, которого
 * никто не проверял.
 *
 * ВТОРАЯ — `String(error)` на экране: «ApiError: боль». Оператору это не
 * говорит ничего, что он мог бы сделать, зато рассказывает про устройство
 * сервера.
 */

const CMS_API = /\/api\/v1\/(cms|tracker)\//
// Через что живёт каркас: ломать это — значит проверять страницу входа.
const VITAL = ['/staff/auth/', '/cms/bootstrap', '/cms/me']

async function breakApi(ctx: BrowserContext, only?: RegExp) {
  await ctx.route('**/api/v1/**', async (route) => {
    const url = route.request().url()
    if (VITAL.some((v) => url.includes(v))) return route.continue()
    if (!CMS_API.test(url)) return route.continue()
    if (only && !only.test(url)) return route.continue()
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      // Текст сервера — то самое, что не должно оказаться на экране.
      body: '{"detail":"боль в базе: relation does not exist"}',
    })
  })
}

async function login(page: Page) {
  await page.goto('/login')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/login')
  await page.getByTestId('login-email').fill(ADMIN.email)
  await page.getByTestId('login-password').fill(ADMIN.password)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/cms\//, { timeout: 30_000 })
}

test.describe('CMS: отказ не врёт', () => {
  test('дашборд при 500 не печатает нулей и показывает отказ', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ru-RU' })
    await breakApi(ctx)
    const page = await ctx.newPage()
    await login(page)
    await page.goto('/cms/dashboard')

    // Ждём нейтрально — по исчезновению загрузки, а не по появлению ошибки:
    // проверка про нули должна сработать РАНЬШЕ проверки про отказ, иначе
    // снятая правка покраснеет на пропавшем элементе, а не на выдуманной цифре.
    await expect(page.locator('main .MuiCircularProgress-root')).toHaveCount(0, {
      timeout: 20_000,
    })

    // ГЛАВНОЕ И ПЕРВЫМ: ни одного нуля в области содержимого. Цифра
    // печатается только тогда, когда сервер ответил и ответил нулём.
    // Проверка стоит раньше проверки плиток намеренно: если правку снимут,
    // краснеть должно на выдуманной цифре, а не на пропавшем элементе.
    const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
    expect(body, `на экране цифра, которой сервер не присылал: «${body}»`).not.toMatch(
      /(^|\D)0(\D|$)/,
    )
    // И самих плиток нет — каждой, а не только заведений.
    for (const tile of ['dashboard-venues', 'dashboard-services', 'dashboard-orders-today']) {
      await expect(page.getByTestId(tile), `плитка ${tile} осталась на экране`).toHaveCount(0)
    }

    await expect(page.getByTestId('state-error')).toBeVisible()
    await expect(page.getByTestId('state-retry')).toBeVisible()

    await ctx.close()
  })

  test('дашборд печатает ноль, когда сервер ответил нулём', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ru-RU' })
    await ctx.route('**/api/v1/cms/services**', async (route) =>
      // Пустая ОБОЛОЧКА: списки CMS отдают items/total/limit, и голый массив
      // здесь проверял бы форму, которой больше нет.
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"items":[],"total":0,"limit":100,"truncated":false}',
      }),
    )
    const page = await ctx.newPage()
    await login(page)
    await page.goto('/cms/dashboard')

    // Обратная сторона правила: пустой ответ — это ноль, и его показывают.
    await expect(page.getByTestId('dashboard-services')).toContainText('0', { timeout: 20_000 })
    await expect(page.getByTestId('state-error')).toHaveCount(0)

    await ctx.close()
  })

  const RAW = ['ApiError', 'relation does not exist', 'боль в базе']

  for (const [name, path] of [
    ['сервисы', '/cms/services'],
    ['витрина', '/cms/brand'],
    ['справочники', '/cms/dictionaries'],
    ['новая позиция', '/cms/menu/items/new'],
    ['новый раздел', '/cms/menu/categories/new'],
    ['номера', '/cms/rooms'],
    ['персонал', '/cms/staff'],
    ['уведомления', '/cms/notifications'],
    ['маркетинг', '/cms/marketing'],
    ['быстрые действия', '/cms/quick-actions'],
    ['управление номером', '/cms/room-control'],
    ['настройки', '/cms/settings'],
    ['трекер', '/tracker'],
  ] as const) {
    test(`${name}: человеческий отказ с повтором, без текста сервера`, async ({ browser }) => {
      const ctx = await browser.newContext({ locale: 'ru-RU' })
      await breakApi(ctx)
      const page = await ctx.newPage()
      await login(page)
      await page.goto(path)
      await page.waitForTimeout(1500)

      const shown = (await page.locator('main, body').last().innerText()).replace(/\s+/g, ' ')
      for (const leak of RAW) {
        expect(shown, `текст сервера на экране: «${shown.slice(0, 160)}»`).not.toContain(leak)
      }
      // Повтор ищем по тексту кнопки: у экранов со своей разметкой он может
      // быть не нашим testid, и «нет testid» — это не «нет повтора».
      await expect(
        page.getByRole('button', { name: /Повторить|Обновить/ }).first(),
        'отказ без повтора — тупик, из которого выходят перезагрузкой вкладки',
      ).toBeVisible({ timeout: 20_000 })

      await ctx.close()
    })
  }

  test('неожиданная форма ответа не гасит CMS целиком', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ru-RU' })
    // Не 500, а мусор нужной размерности: рендер падает уже внутри страницы.
    await ctx.route('**/api/v1/cms/services**', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        // Сервис без `public_name`: страница читает `.ru` и падает на рендере.
        body:
          '{"items":[{"id":"1","code":"x","type":"custom","is_active":true,' +
          '"is_guest_facing":true}],"total":1,"limit":100,"truncated":false}',
      }),
    )
    const page = await ctx.newPage()
    await login(page)
    await page.goto('/cms/dashboard')
    await page.waitForTimeout(2500)

    // Граница поймала падение, и навигация цела: уйти с упавшего экрана
    // можно кликом, а не только через адресную строку.
    await expect(page.getByTestId('screen-crashed')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('nav, .MuiDrawer-root').first()).toBeVisible()

    await ctx.close()
  })
})
