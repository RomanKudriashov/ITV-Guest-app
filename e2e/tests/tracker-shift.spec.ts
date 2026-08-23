import { expect, test, type Page } from '@playwright/test'

import { CREDENTIALS, loginToTracker } from './helpers'

/**
 * СВОДКА СМЕНЫ И НЕПУСТАЯ ПУСТАЯ ДОСКА (партия 2).
 *
 * Ресепшен смотрел в значок и «Заказов нет» часами. Заявок там может не быть
 * полсмены — экран выглядел сломанным ровно тогда, когда всё в порядке.
 *
 * Проверяется, как экран ЧИТАЕТ сводку, поэтому ответ сервера подменяется:
 * закрытые за смену заказы и медиану живым путём не собрать, а если и собрать,
 * тест зависел бы от часа, в который его запустили.
 */

const POINT = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'reception',
  title: 'Ресепшен',
  kind: 'reception',
  sla_minutes: 10,
  tracker_type: 'requests',
  layout: 'columns',
}

const MIDNIGHT = (() => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
})()

function shift(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    new: 0,
    in_work: 0,
    overdue: 0,
    done: 0,
    median_minutes: null,
    median_pickup_minutes: null,
    shift_started_at: MIDNIGHT,
    sla_minutes: 10,
    last_order_at: null,
    ...overrides,
  }
}

async function board(
  page: Page,
  {
    orders = [] as Record<string, unknown>[],
    summary = shift(),
    dead = false,
  }: { orders?: Record<string, unknown>[]; summary?: Record<string, unknown>; dead?: boolean } = {},
): Promise<void> {
  await page.routeWebSocket('**/ws/**', (ws) => ws.close())
  await page.route('**/api/v1/tracker/orders**', async (route) => {
    if (dead) {
      await route.abort()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        point: POINT,
        scope: 'active',
        server_time: new Date().toISOString(),
        tracker_type: 'requests',
        layout: 'columns',
        columns: [
          { code: 'new', title: 'Новая', color_token: 'info', orders },
          { code: 'confirmed', title: 'Подтверждена', color_token: 'warning', orders: [] },
        ],
        next_cursor: null,
        shift: summary,
      }),
    })
  })
}

test.describe('Доска: сводка смены', () => {
  test('УКУС: пустая доска ресепшена показывает итог смены, а не извинение', async ({ page }) => {
    /*
      Тот самый экран. Заявок нет ПРЯМО СЕЙЧАС, но смена шла — и это надо
      сказать: сколько сделано, как быстро берут, как быстро закрывают.
    */
    await board(page, {
      summary: shift({
        done: 14,
        median_minutes: 7,
        median_pickup_minutes: 2,
        last_order_at: new Date(Date.now() - 40 * 60_000).toISOString(),
      }),
    })
    await loginToTracker(page, CREDENTIALS)

    const summary = page.getByTestId('tracker-empty-summary')
    await expect(summary).toBeVisible({ timeout: 20_000 })
    await expect(summary).toHaveText('За смену сделано 14 заявок')

    // Обе скорости названы, и названы РАЗНЫМИ словами: реакция и исполнение —
    // разные болезни, и одно число на двоих лечило бы не то.
    const empty = page.getByTestId('tracker-empty')
    await expect(empty).toContainText('Обычно занимает 7 минут')
    await expect(empty).toContainText('Берут в работу за 2 минуты')
    await expect(empty).toContainText('Последняя заявка — 40 минут')
  })

  test('смена только началась — итога нет, и его не придумывают', async ({ page }) => {
    await board(page, { summary: shift({ done: 0 }) })
    await loginToTracker(page, CREDENTIALS)

    await expect(page.getByTestId('tracker-empty-fresh')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('tracker-empty-summary')).toHaveCount(0)
    // Нулей вместо скорости на экране нет: «0 минут» читалось бы как «мгновенно».
    await expect(page.getByTestId('tracker-empty')).not.toContainText('0 минут')
  })

  test('УКУС: связи нет — доска говорит об этом, а не показывает пустоту', async ({ page }) => {
    /*
      Самый опасный из трёх. Молчащая доска читается как «работы нет», и смена
      спокойно ждёт, пока заявки копятся на сервере. Оба канала обязаны молчать:
      при живом опросе пустота настоящая, и кричать было бы второй ложью.
    */
    await board(page, { dead: true })
    await page.goto('/login')
    await page.getByTestId('login-email').fill(CREDENTIALS.email)
    await page.getByTestId('login-password').fill(CREDENTIALS.password)
    await page.getByTestId('login-submit').click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
    await page.goto('/tracker')

    // Экран говорит о СВЯЗИ, а не о том, что заявок нет.
    const trouble = page.getByText(/связь|Связь/i).first()
    await expect(trouble).toBeVisible({ timeout: 25_000 })
    await expect(page.getByTestId('tracker-empty-summary')).toHaveCount(0)
  })

  test('плитки показывают числа смены; «просрочено» без просрочки не висит', async ({ page }) => {
    await board(page, { summary: shift({ new: 6, in_work: 2, overdue: 0, done: 3 }) })
    await loginToTracker(page, CREDENTIALS)

    await expect(page.getByTestId('tracker-tile-new')).toContainText('6')
    await expect(page.getByTestId('tracker-tile-in_work')).toContainText('2')
    await expect(page.getByTestId('tracker-tile-done')).toContainText('3')
    // Постоянный красный ноль — тревога, которая всегда включена, а значит,
    // её перестают замечать.
    await expect(page.getByTestId('tracker-tile-overdue')).toHaveCount(0)
    // Нечего мерить — прочерк, а не ноль.
    await expect(page.getByTestId('tracker-tile-speed')).toContainText('—')
  })

  test('УКУС: клик по плитке уходит в запрос и остаётся в ссылке', async ({ page }) => {
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
          tracker_type: 'requests',
          layout: 'columns',
          columns: [{ code: 'new', title: 'Новая', color_token: 'info', orders: [] }],
          next_cursor: null,
          shift: shift({ new: 4, overdue: 2, done: 1 }),
        }),
      })
    })
    await loginToTracker(page, CREDENTIALS)

    await page.getByTestId('tracker-tile-overdue').click()

    // Сужает СЕРВЕР: срез обязан уехать в запрос, а не отсеять полученное.
    await expect
      .poll(() => asked.some((url) => url.includes('focus=overdue')), { timeout: 15_000 })
      .toBe(true)
    // И остаться в ссылке: её посылают коллеге, и он видит ТО ЖЕ САМОЕ.
    await expect(page).toHaveURL(/focus=overdue/)
    await expect(page.getByTestId('tracker-tile-overdue')).toHaveAttribute('aria-pressed', 'true')

    // Повторный клик снимает срез — иначе выйти можно было бы только адресом.
    await page.getByTestId('tracker-tile-overdue').click()
    await expect(page).not.toHaveURL(/focus=/)
  })
})
