import { expect, test, type Page } from '@playwright/test'

import { CREDENTIALS, loginToTracker } from './helpers'

/**
 * ФИЛЬТРЫ ДОСКИ (партия 3).
 *
 * Доска показывала всё, что есть у точки. В час пик официант искал глазами,
 * что ещё не взято, а управляющий — что висит на конкретном человеке.
 *
 * Два свойства, ради которых фильтры вообще имеют смысл, и оба проверяются
 * здесь: сужает СЕРВЕР (иначе доска врала бы на первом же заказе, который не
 * приехал) и состояние живёт В АДРЕСЕ (иначе ссылку не послать коллеге, а F5
 * стирает работу).
 */

const POINT = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'kitchen',
  title: 'Кухня ресторана',
  kind: 'kitchen',
  sla_minutes: 20,
  tracker_type: 'board',
  layout: 'columns',
}

const PETR = { id: '33333333-3333-3333-3333-333333333333', name: 'Пётр, повар' }

/** Запросы доски, ушедшие на сервер, — по ним видно, что фильтр доехал. */
async function watchBoard(page: Page): Promise<string[]> {
  const asked: string[] = []
  await page.routeWebSocket('**/ws/**', (ws) => ws.close())
  await page.route('**/api/v1/tracker/orders**', async (route) => {
    asked.push(route.request().url())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        point: POINT,
        scope: 'active',
        server_time: new Date().toISOString(),
        tracker_type: 'board',
        layout: 'columns',
        columns: [{ code: 'new', title: 'Новый', color_token: 'info', orders: [] }],
        next_cursor: null,
        shift: {
          new: 3,
          in_work: 1,
          overdue: 2,
          done: 5,
          median_minutes: 8,
          median_pickup_minutes: 2,
          shift_started_at: new Date().toISOString(),
          sla_minutes: 20,
          last_order_at: null,
        },
        assignees: [PETR],
      }),
    })
  })
  return asked
}

const asked = (urls: string[], part: string) => urls.some((url) => url.includes(part))

test.describe('Доска: фильтры', () => {
  test('УКУС: фильтр применён — ушёл в запрос, а не отсеял полученное', async ({ page }) => {
    const urls = await watchBoard(page)
    await loginToTracker(page, CREDENTIALS)

    await page.getByTestId('tracker-filters-toggle').click()
    await expect(page.getByTestId('tracker-filters-panel')).toBeVisible()

    await page.getByTestId('tracker-filter-unassigned').click()

    await expect.poll(() => asked(urls, 'unassigned=1'), { timeout: 15_000 }).toBe(true)
    await expect(page).toHaveURL(/unassigned=1/)
  })

  test('УКУС: ссылка с фильтром открывается той же выборкой', async ({ page }) => {
    /*
      Смысл состояния в адресе. Открываем ГОТОВУЮ ссылку — панель обязана
      приехать с включёнными галками, а запрос уйти уже с ними, без единого
      клика.
    */
    const urls = await watchBoard(page)
    await page.goto('/login')
    await page.getByTestId('login-email').fill(CREDENTIALS.email)
    await page.getByTestId('login-password').fill(CREDENTIALS.password)
    await page.getByTestId('login-submit').click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })

    await page.goto('/tracker?overdue=1&order_type=cart')
    await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })

    await expect.poll(() => asked(urls, 'overdue=1'), { timeout: 15_000 }).toBe(true)
    expect(asked(urls, 'order_type=cart')).toBe(true)

    // Панель показывает то, что применено: иначе человек видит суженную доску
    // и не понимает, почему заказов мало.
    await page.getByTestId('tracker-filters-toggle').click()
    await expect(page.getByTestId('tracker-filter-overdue')).toBeChecked()
    // И плитка согласована с галкой — параметр у них один.
    await expect(page.getByTestId('tracker-tile-overdue')).toHaveAttribute('aria-pressed', 'true')
  })

  test('число на кнопке говорит, что доска показывает не всё', async ({ page }) => {
    await watchBoard(page)
    await loginToTracker(page, CREDENTIALS)

    // Свёрнутая панель прячет фильтры, и без счётчика человек ищет заказ,
    // которого на суженной доске нет.
    const toggle = page.getByTestId('tracker-filters-toggle')
    await expect(toggle.locator('..')).not.toContainText('1')

    await toggle.click()
    await page.getByTestId('tracker-filter-mine').click()
    await expect(page.getByTestId('tracker-filters-toggle').locator('..')).toContainText('1')

    await page.getByTestId('tracker-filters-reset').click()
    await expect(page).not.toHaveURL(/mine=/)
  })

  test('«мои» и «ничьи» не включаются вместе — это всегда пустая доска', async ({ page }) => {
    await watchBoard(page)
    await loginToTracker(page, CREDENTIALS)

    await page.getByTestId('tracker-filters-toggle').click()
    await page.getByTestId('tracker-filter-mine').click()
    await expect(page.getByTestId('tracker-filter-mine')).toBeChecked()

    await page.getByTestId('tracker-filter-unassigned').click()
    // Взятое мной по определению не ничьё: вместе они дали бы пустоту всегда.
    await expect(page.getByTestId('tracker-filter-unassigned')).toBeChecked()
    await expect(page.getByTestId('tracker-filter-mine')).not.toBeChecked()
  })

  test('под фильтром пусто — «ничего не найдено», а не «заказов нет»', async ({ page }) => {
    await watchBoard(page)
    await loginToTracker(page, CREDENTIALS)

    await page.getByTestId('tracker-filters-toggle').click()
    await page.getByTestId('tracker-filter-overdue').click()

    // Разные ответы: второй заставил бы искать несуществующую причину, почему
    // заказов «нет», хотя их просто спрятал фильтр.
    await expect(page.getByTestId('tracker-empty')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('tracker-empty-summary')).toHaveCount(0)
    await expect(page.getByTestId('tracker-empty-fresh')).toHaveCount(0)
  })

  test('исполнителей предлагает сервер — включая тех, у кого сейчас пусто', async ({ page }) => {
    await watchBoard(page)
    await loginToTracker(page, CREDENTIALS)

    await page.getByTestId('tracker-filters-toggle').click()
    await page.getByTestId('tracker-filter-assignee').click()
    await expect(page.getByRole('option', { name: PETR.name })).toBeVisible()
  })
})
