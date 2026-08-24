import { expect, test, type Page } from '@playwright/test'

import { CREDENTIALS, loginToTracker } from './helpers'

/**
 * ПЕРЕТАСКИВАНИЕ КАРТОЧЕК (партия 4).
 *
 * Самая рискованная правка трекера: жест накладывается на ЖИВУЮ доску, которую
 * сервер заменяет целиком при каждом событии точки. Три правила и проверяются
 * здесь — придержка снимков, оптимистичный сдвиг до ответа сервера, запрет,
 * видимый до броска.
 *
 * Доска подменяется ответом сервера: живым путём нельзя ни выбрать момент
 * прихода снимка, ни заставить сервер отказать в переходе.
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

const SHIFT = {
  new: 1,
  in_work: 0,
  overdue: 0,
  done: 0,
  median_minutes: null,
  median_pickup_minutes: null,
  shift_started_at: new Date().toISOString(),
  sla_minutes: 20,
  last_order_at: null,
}

/** Заказ в «Принят»: вперёд ему можно в «Готовится», назад — некуда. */
function order(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    number: 9100,
    type: 'cart',
    status: { code: 'accepted', title: 'Принят', color_token: 'info' },
    status_flow: [],
    history: [],
    room: '305',
    location: null,
    delivery_mode: 'asap',
    requested_time: null,
    comment: '',
    total: 100000,
    currency: 'RUB',
    created_at: new Date().toISOString(),
    items: [{ title: 'Борщ', quantity: 1 }],
    field_values: [],
    execution_point: POINT,
    assignee: null,
    accepted_at: null,
    waiting_minutes: 3,
    is_overdue: false,
    overdue_minutes: null,
    next_statuses: [{ code: 'preparing', title: 'Готовится' }],
    can_cancel: true,
    ...overrides,
  }
}

const COLUMNS = ['new', 'accepted', 'preparing', 'on_the_way'] as const
const TITLES: Record<string, string> = {
  new: 'Новый',
  accepted: 'Принят',
  preparing: 'Готовится',
  on_the_way: 'В пути',
}

function boardBody(placement: Record<string, Record<string, unknown>[]>) {
  return JSON.stringify({
    point: POINT,
    scope: 'active',
    server_time: new Date().toISOString(),
    tracker_type: 'board',
    layout: 'columns',
    columns: COLUMNS.map((code) => ({
      code,
      title: TITLES[code],
      color_token: 'info',
      orders: placement[code] ?? [],
    })),
    next_cursor: null,
    shift: SHIFT,
    assignees: [],
  })
}

/** Тело доски, где заказ лежит в колонке своего текущего статуса. */
function boardBodyFor(single: Record<string, unknown>): string {
  const code = (single.status as { code: string }).code
  return boardBody({ [code]: [single] })
}

interface Stand {
  /** Куда ушли запросы смены статуса. */
  moves: { orderId: string; status: string }[]
}

async function stand(page: Page, { moveStatus = 200 } = {}): Promise<Stand> {
  const moves: Stand['moves'] = []
  /*
    Стенд ЧЕСТНЫЙ: удавшийся перевод меняет и доску тоже.

    Первая версия отвечала «переведено», а доску отдавала прежнюю — и карточка
    справедливо возвращалась назад, потому что снимок сервера её там и
    показывал. Тест ловил не дефект, а собственную ложь: настоящий сервер
    после успешного перехода отдаёт заказ уже в новой колонке.
  */
  let placement: Record<string, Record<string, unknown>[]> = { accepted: [order()] }

  await page.routeWebSocket('**/ws/**', (ws) => ws.close())
  await page.route('**/api/v1/tracker/orders**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: boardBody(placement) })
  })
  await page.route('**/api/v1/tracker/order/*/status', async (route) => {
    const status = (route.request().postDataJSON() as { status: string }).status
    moves.push({
      orderId: route.request().url().split('/order/')[1].split('/')[0],
      status,
    })
    if (moveStatus !== 200) {
      await route.fulfill({
        status: moveStatus,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'Заказ уже завершён',
          code: 'order_finished',
        }),
      })
      return
    }
    const moved = order({ status: { code: status, title: TITLES[status], color_token: 'warning' } })
    placement = { [status]: [moved] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(moved) })
  })
  return { moves }
}

/** Перетащить за ручку: жест начинается с неё, а не с карточки. */
async function dragTo(page: Page, number: number, column: string): Promise<void> {
  const grip = page.getByTestId(`tracker-grip-${number}`)
  const target = page.getByTestId(`tracker-column-${column}`)
  await grip.hover()
  await page.mouse.down()
  // Два шага: первый перебирает порог захвата, второй доводит до цели.
  const box = (await target.boundingBox()) as { x: number; y: number; width: number; height: number }
  await page.mouse.move(box.x + box.width / 2, box.y + 30, { steps: 6 })
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()
}

test.describe('Доска: перетаскивание', () => {
  test('УКУС: бросок вперёд проходит и уходит на сервер', async ({ page }) => {
    const bench = await stand(page)
    await loginToTracker(page, CREDENTIALS)
    await expect(page.getByTestId('tracker-order-9100')).toBeVisible({ timeout: 20_000 })

    await dragTo(page, 9100, 'preparing')

    // Ушло на сервер — перетаскивание МЕНЯЕТ статус, а не переставляет картинку.
    await expect.poll(() => bench.moves.length, { timeout: 15_000 }).toBe(1)
    expect(bench.moves[0].status).toBe('preparing')
    // И карточка уже в целевой колонке, не дожидаясь нового снимка.
    await expect(
      page.getByTestId('tracker-column-preparing').getByTestId('tracker-order-9100'),
    ).toBeVisible()
  })

  test('УКУС: бросок назад невозможен, и это видно ДО броска', async ({ page }) => {
    /*
      Переходы идут только вперёд: блюдо нельзя разготовить. Красный отказ
      после броска был бы НАШЕЙ ошибкой — запрет мы знали заранее, разрешённые
      статусы приезжают с каждым заказом.
    */
    const bench = await stand(page)
    await loginToTracker(page, CREDENTIALS)
    const grip = page.getByTestId('tracker-grip-9100')
    await expect(grip).toBeVisible({ timeout: 20_000 })

    // В покое колонки ничем не помечены — доска не пестрит без нужды.
    await expect(page.getByTestId('tracker-column-new')).toHaveAttribute('data-drop', 'idle')

    await grip.hover()
    await page.mouse.down()
    const back = page.getByTestId('tracker-column-new')
    const box = (await back.boundingBox()) as { x: number; y: number; width: number; height: number }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 })

    // ВОТ ОНО: запрет виден, пока палец ещё держит карточку.
    await expect(back).toHaveAttribute('data-drop', 'forbidden')
    await expect(page.getByTestId('tracker-column-preparing')).toHaveAttribute(
      'data-drop',
      'allowed',
    )

    await page.mouse.up()

    // Бросок назад не состоялся: ни запроса, ни переезда карточки.
    await page.waitForTimeout(600)
    expect(bench.moves).toHaveLength(0)
    await expect(
      page.getByTestId('tracker-column-accepted').getByTestId('tracker-order-9100'),
    ).toBeVisible()
  })

  test('УКУС: снимок во время перетаскивания не уводит доску', async ({ page }) => {
    /*
      Снимок ЗАМЕНЯЕТ доску целиком — в этом вся его надёжность. Но пришедший
      под пальцем, он перестраивает колонки: карточка уезжает из-под руки, а
      цель броска оказывается не там, где была.

      Здесь снимок настоящий, из сокета, и он переносит наш заказ в другую
      колонку ровно в момент жеста. Пока палец держит — доска обязана стоять;
      на отпускании накопленное применяется, и ничего не теряется.
    */
    const moves: Stand['moves'] = []
    let socket: { send: (data: string) => void } | null = null
    await page.routeWebSocket('**/ws/**', (ws) => {
      socket = ws as unknown as { send: (data: string) => void }
      ;(ws as unknown as { onMessage: (cb: () => void) => void }).onMessage(() => {})
    })
    await page.route('**/api/v1/tracker/orders**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: boardBody({ accepted: [order()] }),
      })
    })
    await page.route('**/api/v1/tracker/order/*/status', async (route) => {
      moves.push({ orderId: '', status: (route.request().postDataJSON() as { status: string }).status })
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order()) })
    })

    await loginToTracker(page, CREDENTIALS)
    const grip = page.getByTestId('tracker-grip-9100')
    await expect(grip).toBeVisible({ timeout: 20_000 })
    await expect
      .poll(() => socket !== null, { timeout: 15_000 })
      .toBe(true)

    // Берём карточку и уводим палец на ЗАПРЕЩЁННУЮ колонку: броска не будет,
    // и проверка останется про снимок, а не про перевод статуса.
    await grip.hover()
    await page.mouse.down()
    const back = page.getByTestId('tracker-column-new')
    const box = (await back.boundingBox()) as { x: number; y: number; width: number; height: number }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 })
    await expect(back).toHaveAttribute('data-drop', 'forbidden')

    // Снимок под пальцем: сервер переносит заказ в «В пути».
    const moved = order({
      status: { code: 'on_the_way', title: 'В пути', color_token: 'warning' },
      next_statuses: [{ code: 'done', title: 'Доставлено' }],
    })
    await page.evaluate(() => undefined)
    ;(socket as unknown as { send: (data: string) => void }).send(
      JSON.stringify({
        type: 'tracker.snapshot',
        event: 'order.status_changed',
        board: JSON.parse(boardBodyFor(moved)),
      }),
    )
    await page.waitForTimeout(500)

    // ДОСКА СТОИТ: карточка там же, где её взяли.
    await expect(
      page.getByTestId('tracker-column-accepted').getByTestId('tracker-order-9100'),
    ).toBeVisible()

    await page.mouse.up()

    // Броска не было — статус никто не двигал.
    expect(moves).toHaveLength(0)
    // А накопленный снимок применился: он не потерян, просто дождался руки.
    await expect(
      page.getByTestId('tracker-column-on_the_way').getByTestId('tracker-order-9100'),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('УКУС: отказ сервера разворачивает карточку и объясняет почему', async ({ page }) => {
    await stand(page, { moveStatus: 409 })
    await loginToTracker(page, CREDENTIALS)
    await expect(page.getByTestId('tracker-order-9100')).toBeVisible({ timeout: 20_000 })

    await dragTo(page, 9100, 'preparing')

    // Карточка вернулась в свою колонку — наложение снято ответом сервера.
    await expect(
      page.getByTestId('tracker-column-accepted').getByTestId('tracker-order-9100'),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByTestId('tracker-column-preparing').getByTestId('tracker-order-9100'),
    ).toHaveCount(0)
    // И сказано почему, а не молча.
    await expect(page.getByTestId('tracker-error-9100')).toBeVisible()
  })

  test('ручка отделена от тапа: нажатие на карточку открывает подробности', async ({ page }) => {
    await stand(page)
    await loginToTracker(page, CREDENTIALS)
    const card = page.getByTestId('tracker-order-9100')
    await expect(card).toBeVisible({ timeout: 20_000 })

    // Тап по телу карточки — подробности, как и было.
    await card.getByText('№9100').click()
    await expect(page).toHaveURL(/\/tracker\/order\//)
  })
})
