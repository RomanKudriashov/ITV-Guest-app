import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { CREDENTIALS, signIn } from './helpers'

/**
 * СВЕЖЕСТЬ ИСТОРИИ — ВРЕМЕНЕМ, А НЕ ОБЕЩАНИЕМ (партия 55).
 *
 * Под историей стояло «Доска обновляется в реальном времени» — подпись
 * активной доски, а сокет историю не ведёт: закрытый заказ появлялся в ней
 * только после перезагрузки. Пустая история к тому же обещала «за последние
 * сутки», хотя окна в сутки давно нет.
 *
 * Теперь история говорит, когда её получили («Обновлено в ЧЧ:ММ»), даёт
 * обновить руками, и поиск открывает панель — первым, а не третьим сверху.
 *
 * Доска подменена: проверяется экран, а не данные стенда, и прогон ничего
 * на стенде не пишет.
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

/** Запросы доски, ушедшие на сервер, — по ним видно, что история перечитана. */
async function watchBoards(page: Page): Promise<string[]> {
  const asked: string[] = []
  await page.routeWebSocket('**/ws/**', (ws) => ws.close())
  await page.route('**/api/v1/tracker/orders**', async (route) => {
    const url = route.request().url()
    asked.push(url)
    const history = url.includes('scope=history')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        point: POINT,
        scope: history ? 'history' : 'active',
        server_time: new Date().toISOString(),
        tracker_type: 'board',
        layout: 'columns',
        columns: history
          ? [{ code: 'history', title: '', orders: [] }]
          : [{ code: 'new', title: 'Новый', color_token: 'info', orders: [] }],
        next_cursor: null,
        shift: {
          new: 0,
          in_work: 0,
          overdue: 0,
          done: 0,
          median_minutes: null,
          median_accept_minutes: null,
          shift_started_at: new Date().toISOString(),
          sla_minutes: 20,
          last_order_at: null,
        },
        assignees: [],
        statuses: history ? [] : null,
        selection: history
          ? { orders: 0, revenue_minor: 0, cancelled: 0, median_minutes: null }
          : undefined,
      }),
    })
  })
  return asked
}

const historyRequests = (urls: string[]) => urls.filter((url) => url.includes('scope=history')).length

async function openHistory(page: Page): Promise<string[]> {
  const urls = await watchBoards(page)
  await signIn(page, CREDENTIALS)
  await page.goto('/tracker')
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('tracker-history-tab').click()
  await expect.poll(() => historyRequests(urls), { timeout: 15_000 }).toBeGreaterThan(0)
  await expect(page.getByTestId('tracker-history-updated')).toBeVisible({ timeout: 15_000 })
  return urls
}

test.describe('История трекера: свежесть', () => {
  test('УКУС: на истории нет «в реальном времени» и «сутки», есть «Обновлено в» и «Обновить»', async ({
    page,
  }) => {
    await openHistory(page)
    const screen = page.getByTestId('tracker-screen')

    await expect(screen).not.toContainText('в реальном времени')
    await expect(screen).not.toContainText('сутки')
    await expect(page.getByTestId('tracker-live-caption')).toHaveCount(0)

    await expect(page.getByTestId('tracker-history-updated')).toContainText(/Обновлено в \d{1,2}:\d{2}/)
    await expect(page.getByTestId('tracker-history-refresh')).toBeVisible()
    await expect(page.getByTestId('tracker-history-refresh')).toHaveText(/Обновить/)
  })

  test('УКУС: «Обновить» перечитывает историю с сервера и сдвигает время получения', async ({ page }) => {
    const urls = await openHistory(page)
    const updated = page.getByTestId('tracker-history-updated')
    const before = Number(await updated.getAttribute('data-updated-at'))
    const asked = historyRequests(urls)

    // Минутная точность подписи не даст увидеть сдвиг за секунду — сверяем
    // момент получения в атрибуте и сам запрос.
    await page.waitForTimeout(50)
    await page.getByTestId('tracker-history-refresh').click()

    await expect.poll(() => historyRequests(urls), { timeout: 15_000 }).toBeGreaterThan(asked)
    await expect
      .poll(async () => Number(await updated.getAttribute('data-updated-at')), { timeout: 15_000 })
      .toBeGreaterThan(before)
  })

  test('возврат на «Историю» с другой вкладки перечитывает её', async ({ page }) => {
    const urls = await openHistory(page)
    await page.getByTestId('tracker-active-tab').click()
    const asked = historyRequests(urls)

    await page.getByTestId('tracker-history-tab').click()
    await expect.poll(() => historyRequests(urls), { timeout: 15_000 }).toBeGreaterThan(asked)
  })

  test('поиск — первый элемент панели, кнопка «Фильтры» за ним', async ({ page }) => {
    await openHistory(page)
    const row = page.getByTestId('tracker-panel-row')
    await expect(row).toBeVisible()

    // Первый ребёнок строки содержит поле поиска.
    const first = row.locator(':scope > *').first()
    await expect(first.getByTestId('tracker-search')).toHaveCount(1)

    // И стоит выше всего остального в панели и над сводкой.
    const search = await page.getByTestId('tracker-search').boundingBox()
    const toggle = await page.getByTestId('tracker-filters-toggle').boundingBox()
    const numbers = await page.getByTestId('orders-numbers').boundingBox()
    expect(search && toggle && numbers).toBeTruthy()
    if (search && toggle && numbers) {
      expect(search.y).toBeLessThanOrEqual(toggle.y + toggle.height)
      expect(search.y).toBeLessThan(numbers.y)
    }
  })
})
