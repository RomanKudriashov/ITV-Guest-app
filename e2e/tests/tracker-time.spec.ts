import { expect, test, type Page } from '@playwright/test'

import { CREDENTIALS, loginToTracker } from './helpers'

/**
 * ВРЕМЯ И ПОРОГИ НА ДОСКЕ (партия 1).
 *
 * Карточка печатала сырое `waiting_minutes`. На стенде это доходило до
 * «89700 мин» — повар обязан был делить в уме на шестьдесят и на двадцать
 * четыре, чтобы понять, что заказ висит с позапрошлой недели. Красная метка
 * просрочки при этом молчала и о величине, и о пороге, от которого считается.
 *
 * Возраст СТАРОГО заказа живым путём не получить: заказ, созданный тестом,
 * всегда молод. Поэтому доска подменяется ответом сервера — проверяется ровно
 * то, ради чего правка делалась: как экран ЧИТАЕТ то, что ему прислали.
 */

/** Точка с порогом 20 минут — то же число, что стоит у кухни по умолчанию. */
const POINT = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'kitchen',
  title: 'Кухня ресторана',
  kind: 'kitchen',
  sla_minutes: 20,
  tracker_type: 'board',
  layout: 'columns',
}

function order(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    number: 9001,
    type: 'order',
    status: { code: 'new', title: 'Новый', color_token: 'info' },
    status_flow: [],
    history: [],
    room: '305',
    location: null,
    delivery_mode: 'asap',
    requested_time: null,
    comment: '',
    total: 100000,
    currency: 'RUB',
    items: [{ title: 'Борщ', quantity: 1 }],
    field_values: [],
    execution_point: POINT,
    assignee: null,
    accepted_at: null,
    waiting_minutes: 5,
    is_overdue: false,
    overdue_minutes: null,
    next_statuses: [],
    can_cancel: true,
    ...overrides,
  }
}

async function showBoard(page: Page, orders: Record<string, unknown>[]): Promise<void> {
  // Сокет глушим: иначе живой снимок заменит подменённую доску через секунду.
  await page.routeWebSocket('**/ws/**', (ws) => ws.close())
  await page.route('**/api/v1/tracker/orders**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        point: POINT,
        scope: 'active',
        server_time: new Date().toISOString(),
        tracker_type: 'board',
        layout: 'columns',
        columns: [{ code: 'new', title: 'Новый', color_token: 'info', orders }],
        next_cursor: null,
      }),
    })
  })
}

/** ISO-момент N минут назад — возраст карточки и её час обязаны сходиться. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

test.describe('Доска: время и пороги', () => {
  test('УКУС: заказ двухсуточной давности читается словами, а не числом минут', async ({
    page,
  }) => {
    /*
      Ровно тот случай со стенда. Двое суток — это 2880 минут, и именно так
      карточка их и печатала. Дальше суток длительность перестаёт помогать:
      важно КОГДА заказ приняли, а не сколько тысяч минут прошло.
    */
    const created = minutesAgo(2 * 24 * 60 + 15)
    await showBoard(page, [
      order({ created_at: created, waiting_minutes: 2 * 24 * 60 + 15, is_overdue: true, overdue_minutes: 2 * 24 * 60 - 5 }),
    ])
    await loginToTracker(page, CREDENTIALS)

    const age = page.getByTestId('tracker-waiting-9001')
    await expect(age).toBeVisible({ timeout: 20_000 })

    // Числа минут на карточке больше нет НИГДЕ — ни в возрасте, ни в просрочке.
    await expect(age).not.toContainText('2895')
    await expect(page.getByTestId('tracker-order-9001')).not.toContainText(/\d{4,}\s*мин/)

    // Возраст — датой: заказ позапрошлого дня называют днём, а не длительностью.
    const expected = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(
      new Date(created),
    )
    await expect(age).toHaveText(expected)

    // Час приёма стоит рядом и крупно: заказ называют по нему вслух.
    await expect(page.getByTestId('tracker-clock-9001')).toHaveText(/\d{1,2}:\d{2}/)
  })

  test('свежий заказ — минутами с правильной формой, час рядом', async ({ page }) => {
    await showBoard(page, [order({ created_at: minutesAgo(2), waiting_minutes: 2 })])
    await loginToTracker(page, CREDENTIALS)

    // Две минуты — форма «минуты», а не «минут»: у русского три формы, и
    // склейка «{{count}} мин» скрывала бы это навсегда.
    await expect(page.getByTestId('tracker-waiting-9001')).toHaveText('2 минуты')
    await expect(page.getByTestId('tracker-clock-9001')).toHaveText(/\d{1,2}:\d{2}/)
  })

  test('несколько часов — часы и минуты, а не сотни минут', async ({ page }) => {
    await showBoard(page, [order({ created_at: minutesAgo(135), waiting_minutes: 135 })])
    await loginToTracker(page, CREDENTIALS)

    await expect(page.getByTestId('tracker-waiting-9001')).toHaveText('2 ч 15 мин')
  })

  test('УКУС: просрочка называет величину, а порог написан словами', async ({ page }) => {
    /*
      Красный чип без числа одинаково выглядел у опоздавшего на минуту и у
      забытого на сутки. А без названного порога человек не мог понять, много
      двадцать минут или мало для этой точки.
    */
    await showBoard(page, [
      order({ created_at: minutesAgo(28), waiting_minutes: 28, is_overdue: true, overdue_minutes: 8 }),
    ])
    await loginToTracker(page, CREDENTIALS)

    await expect(page.getByTestId('tracker-overdue-9001')).toHaveText('просрочен на 8 минут')
    // Порог — из настройки ТОЧКИ, а не из константы во фронте.
    await expect(page.getByTestId('tracker-sla-hint')).toContainText('20')
  })

  test('заказ в срок просрочку не показывает', async ({ page }) => {
    await showBoard(page, [order({ created_at: minutesAgo(5), waiting_minutes: 5 })])
    await loginToTracker(page, CREDENTIALS)

    await expect(page.getByTestId('tracker-waiting-9001')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('tracker-overdue-9001')).toHaveCount(0)
  })
})
