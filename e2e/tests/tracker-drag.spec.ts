import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { CREDENTIALS, DEMO_ROOM, signInToTracker, waitForLayout } from './helpers'

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
    room: DEMO_ROOM,
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
  /** Куда ушли запросы ПЕРЕСТАНОВКИ внутри колонки — это другая ручка. */
  positions: string[]
}

async function stand(page: Page, { moveStatus = 200 } = {}): Promise<Stand> {
  const moves: Stand['moves'] = []
  const positions: Stand['positions'] = []
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
  // Перестановка внутри колонки — ОТДЕЛЬНАЯ ручка. Без её мока запрос уходил
  // на живой сервер, тот отвечал 404 (заказа 9100 в базе нет), и на карточке
  // всплывало «заказ не найден» — ровно это и увидел упавший клавиатурный
  // тест. Мок доски обязан отвечать на всё, что доска умеет посылать.
  await page.route('**/api/v1/tracker/order/*/position', async (route) => {
    positions.push(route.request().url().split('/order/')[1].split('/')[0])
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(order()),
    })
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
  return { moves, positions }
}

/**
 * Перетащить ЗА ТЕЛО карточки. Ручка осталась подсказкой и слушателей больше
 * не имеет — захват шире на всю карточку.
 */
async function dragTo(page: Page, number: number, column: string): Promise<void> {
  const card = page.getByTestId(`tracker-order-${number}`)
  const target = page.getByTestId(`tracker-column-${column}`)
  await card.hover()
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
    await signInToTracker(page, CREDENTIALS)
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

  test('УКУС: неразрешённая колонка не принимает бросок, и это видно ДО броска', async ({
    page,
  }) => {
    /*
      ПРАВИЛО ИЗМЕНИЛОСЬ, ПРОВЕРКА ОСТАЛАСЬ — И ЭТО РАЗНЫЕ ВЕЩИ.

      Раньше здесь было записано «переходы идут только вперёд». С этой партии
      назад ходить можно: промах по карточке иначе чинится только правкой в
      базе. Но проверяемое правило было не про «вперёд», а про ЧЕСТНОСТЬ
      КЛИЕНТА: доска не принимает бросок туда, чего сервер не разрешил, и
      говорит об этом, пока палец ещё держит карточку. Красный отказ после
      броска на том, что мы могли запретить заранее, — наша ошибка.

      Список разрешённого по-прежнему целиком с сервера (`next_statuses`), и
      здесь он замокан так, что «Новый» в него не входит.
    */
    const bench = await stand(page)
    await signInToTracker(page, CREDENTIALS)
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
    await waitForLayout(page)
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

    await signInToTracker(page, CREDENTIALS)
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
    await waitForLayout(page)

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
    await signInToTracker(page, CREDENTIALS)
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


  test('УКУС: тянется ВСЯ карточка, а не только ручка', async ({ page }) => {
    /*
      Ручка была единственным местом захвата, и это объяснялось тем, что палец
      на кухне попадает неточно. Теперь различает жесты порог активации, а
      тянуть можно за тело — за номер, за состав, за любое место без кнопки.
    */
    const { moves } = await stand(page)
    await signInToTracker(page, CREDENTIALS)
    await expect(page.getByTestId('tracker-order-9100')).toBeVisible({ timeout: 20_000 })

    // Беремся за НОМЕР заказа — это тело карточки, не ручка.
    const grabPoint = page.getByTestId('tracker-order-9100').getByText('№9100')
    const target = page.getByTestId('tracker-column-preparing')
    await grabPoint.hover()
    await page.mouse.down()
    const box = (await target.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 30, { steps: 6 })
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 })
    await page.mouse.up()

    await expect
      .poll(() => moves.map((m) => m.status), { timeout: 10_000 })
      .toEqual(['preparing'])
    await expect(page.getByTestId('tracker-column-preparing').getByTestId('tracker-order-9100'))
      .toBeVisible()
  })

  test('УКУС: тап «жирным пальцем» со смещением 5–6px ОТКРЫВАЕТ карточку', async ({ page }) => {
    /*
      Ровно та причина, по которой захват держали на ручке: палец смещается на
      пять-шесть пикселей при обычном тапе. Порог мыши — восемь, и такой тап
      обязан дойти до карточки кликом, а не превратиться в микроперенос.
    */
    const { moves } = await stand(page)
    await signInToTracker(page, CREDENTIALS)
    const card = page.getByTestId('tracker-order-9100')
    await expect(card).toBeVisible({ timeout: 20_000 })

    const box = (await card.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    // Смещение МЕНЬШЕ порога: 5 и 6 пикселей.
    await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2 + 6)
    await page.mouse.up()

    await expect(page, 'дрожание руки увело в перенос вместо открытия').toHaveURL(
      /\/tracker\/order\//,
      { timeout: 10_000 },
    )
    expect(moves, 'тап отправил смену статуса').toEqual([])
  })

  test('УКУС: несомая карточка едет под курсором, на месте — контур', async ({ page }) => {
    await stand(page)
    await signInToTracker(page, CREDENTIALS)
    const card = page.getByTestId('tracker-order-9100')
    await expect(card).toBeVisible({ timeout: 20_000 })

    const target = page.getByTestId('tracker-column-preparing')
    await card.hover()
    await page.mouse.down()
    const box = (await target.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 40, { steps: 8 })

    // Под курсором — наложение с той же карточкой.
    await expect(page.getByTestId('tracker-drag-overlay')).toBeVisible()
    // На месте — контур: сама карточка помечена как несомая.
    await expect(page.getByTestId('tracker-order-9100').first()).toHaveAttribute(
      'data-dragging',
      'true',
    )
    // И в целевой колонке раздвинулось место.
    await expect(target.getByTestId('tracker-drop-placeholder')).toBeVisible()

    await page.mouse.up()
    await expect(page.getByTestId('tracker-drag-overlay')).toHaveCount(0)
  })

  test('УКУС: глушится только запрещённое, а не вся доска', async ({ page }) => {
    await stand(page)
    await signInToTracker(page, CREDENTIALS)
    const card = page.getByTestId('tracker-order-9100')
    await expect(card).toBeVisible({ timeout: 20_000 })

    await card.hover()
    await page.mouse.down()
    const target = (await page.getByTestId('tracker-column-preparing').boundingBox())!
    await page.mouse.move(target.x + target.width / 2, target.y + 40, { steps: 8 })

    // Разрешённая — приглашает; запрещённые — гаснут; вся доска НЕ гаснет.
    await expect(page.getByTestId('tracker-column-preparing')).toHaveAttribute('data-drop', 'allowed')
    await expect(page.getByTestId('tracker-column-new')).toHaveAttribute('data-drop', 'forbidden')
    await expect(page.getByTestId('tracker-column-on_the_way')).toHaveAttribute(
      'data-drop',
      'forbidden',
    )
    await page.mouse.up()
  })

  test('УКУС: промах мимо колонок возвращает карточку, а не теряет её', async ({ page }) => {
    const { moves } = await stand(page)
    await signInToTracker(page, CREDENTIALS)
    const card = page.getByTestId('tracker-order-9100')
    await expect(card).toBeVisible({ timeout: 20_000 })

    await card.hover()
    await page.mouse.down()
    // В пустоту под доской — мимо любой колонки.
    await page.mouse.move(5, 5, { steps: 8 })
    await page.mouse.up()

    // Карточка на прежнем месте и цела, запроса не было.
    await expect(page.getByTestId('tracker-column-accepted').getByTestId('tracker-order-9100'))
      .toBeVisible()
    await expect(page.getByTestId('tracker-drag-overlay')).toHaveCount(0)
    expect(moves, 'промах отправил смену статуса').toEqual([])
  })

  test('УКУС: чужие руки во время переноса названы, а не выданы за запрет', async ({ page }) => {
    /*
      Снимки на время жеста придержаны, а свой заказ помечен «нашим» ДО
      запроса — значит сравнение снимков об этом промолчит. Человек получил бы
      сухое «нельзя перейти» и решил, что запретила система, хотя карточку увёл
      сосед по смене.
    */
    await page.routeWebSocket('**/ws/**', (ws) => ws.close())
    let placement: Record<string, Record<string, unknown>[]> = { accepted: [order()] }
    await page.route('**/api/v1/tracker/orders**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: boardBody(placement) })
    })
    await page.route('**/api/v1/tracker/order/*/status', async (route) => {
      // Пока карточку несли, её передвинул кто-то другой: сервер отказывает
      // ровно тем кодом, каким отказывает на устаревший переход.
      placement = { preparing: [order({ status: { code: 'preparing', title: 'Готовится', color_token: 'warning' } })] }
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'Из статуса «Готовится» нельзя перейти в «preparing»',
          code: 'invalid_transition',
        }),
      })
    })

    await signInToTracker(page, CREDENTIALS)
    await expect(page.getByTestId('tracker-order-9100')).toBeVisible({ timeout: 20_000 })
    await dragTo(page, 9100, 'preparing')

    // Сказано ИМЕННО ЭТО, а не «нельзя перейти».
    const notice = page.getByTestId('tracker-handover')
    await expect(notice).toBeVisible({ timeout: 10_000 })
    await expect(notice).toContainText('9100')
    await expect(notice).toContainText(/кто-то другой|передвинуть/i)
  })



  test('УКУС: 404 — это «заказа больше нет», а не «чужие руки»', async ({ page }) => {
    /*
      «Не найден» бывает не только от чужих рук: заказ убирает закрытие смены,
      удаление администратором и обычная уборка стенда — она съедала их
      десятками. Сказать в этот момент «успел передвинуть кто-то другой» значит
      назвать человека, которого не было.
    */
    await page.routeWebSocket('**/ws/**', (ws) => ws.close())
    const placement: Record<string, Record<string, unknown>[]> = { accepted: [order()] }
    await page.route('**/api/v1/tracker/orders**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: boardBody(placement) })
    })
    await page.route('**/api/v1/tracker/order/*/status', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Заказ не найден' }),
      })
    })

    await signInToTracker(page, CREDENTIALS)
    await expect(page.getByTestId('tracker-order-9100')).toBeVisible({ timeout: 20_000 })
    await dragTo(page, 9100, 'preparing')

    const notice = page.getByTestId('tracker-handover')
    await expect(notice).toBeVisible({ timeout: 10_000 })
    await expect(notice).toContainText('9100')
    await expect(notice, 'на 404 названы чужие руки, которых не было').not.toContainText(
      /кто-то другой|передвинуть/i,
    )
    await expect(notice).toContainText(/больше нет/i)
  })


  test('УКУС: перенос с клавиатуры — пробел, стрелка, пробел', async ({ page }) => {
    /*
      ЖЕСТ ЗАМЕРЕН, А НЕ ПРЕДПОЛОЖЕН. Карточка — `role="button"`, `tabindex=0`,
      `aria-roledescription="draggable"`; пробел поднимает (появляется
      наложение), стрелка ведёт к соседней колонке, второй пробел кладёт.

      Клавиатура — не украшение: доска стоит на кухне, где мышь мокрая, а
      сенсорный экран засален. `onDragEnd` к ней готов давно — в нём отдельная
      проверка перехода с пометкой «клавиатурный жест не обязан знать про
      правило».
    */
    const { moves, positions } = await stand(page)
    await signInToTracker(page, CREDENTIALS)
    const card = page.getByTestId('tracker-order-9100')
    await expect(card).toBeVisible({ timeout: 20_000 })

    // Карточка достижима с клавиатуры и объявляет себя переносимой.
    await expect(card).toHaveAttribute('role', 'button')
    await expect(card).toHaveAttribute('aria-roledescription', 'draggable')

    await card.focus()
    await page.keyboard.press('Space')
    await expect(page.getByTestId('tracker-drag-overlay'), 'пробел не поднял карточку').toBeVisible()

    /*
      ОДНО НАЖАТИЕ — ОДНА КОЛОНКА. Замер до правки: шаг по умолчанию 25px при
      ширине колонки 340px, то есть пятнадцать нажатий на один перенос. Колонка
      — единица работы этой доски, ею и шагаем.
    */
    await page.keyboard.press('ArrowRight')
    /*
      ЖДЁМ, ПОКА ЦЕЛЬ РЕАЛЬНО СМЕНИЛАСЬ, А НЕ ЧЕТВЕРТЬ СЕКУНДЫ.

      Здесь стояло `waitForTimeout(250)`, и проверка краснела на исправном
      жесте, стоило странице потяжелеть: второй пробел приходил раньше, чем
      dnd-kit пересчитывал цель, и жест завершался ПЕРЕСТАНОВКОЙ внутри своей
      колонки — законным, но совсем другим действием. Замер: с паузой на пару
      лишних измерений тест проходил, без неё — нет. Фиксированная пауза мерила
      скорость машины, а не продукт.

      Признак готовности — зазор в ЦЕЛЕВОЙ колонке: он появляется ровно тогда,
      когда цель уже пересчитана.
    */
    /*
      ПАУЗА ПЕРЕД ВТОРЫМ ПРОБЕЛОМ — И ЕЁ ПРИХОДИТСЯ МЕРИТЬ ВРЕМЕНЕМ.

      Здесь стояло 250 мс, и проверка краснела на исправном жесте, стоило
      странице потяжелеть: второй пробел приходил раньше, чем dnd-kit
      пересчитывал цель, и жест завершался ПЕРЕСТАНОВКОЙ внутри своей колонки —
      законным, но совсем другим действием (видно по запросу на `/position`
      вместо `/status`).

      Опереться на разметку нельзя, и это НЕ ЛЕНЬ, а замер: при клавиатурном
      переносе наложение не двигается (x=378 до шага и после), `onDragMove` и
      `onDragOver` не приходят вовсе, зазор не рисуется. Признака готовности в
      DOM попросту нет — пока видимость клавиатурного жеста не сделана
      отдельной работой, ждать приходится временем.
    */
    await waitForLayout(page)

    await page.keyboard.press('Space')

    await expect
      .poll(() => moves.map((m) => m.status), { timeout: 10_000 })
      .toEqual(['preparing'])
    // И это была СМЕНА КОЛОНКИ, а не перестановка внутри своей: с появлением
    // ручного порядка бросок в ту же колонку — законное, но совсем другое
    // действие, и спутать их значит объявить сломанный жест рабочим.
    expect(positions, 'стрелка не сменила колонку — жест свёлся к перестановке').toEqual([])
    await expect(
      page.getByTestId('tracker-column-preparing').getByTestId('tracker-order-9100'),
    ).toBeVisible()
    await expect(page.getByTestId('tracker-drag-overlay')).toHaveCount(0)
  })

  test('перенос только там, где есть куда бросить: ниже md его нет', async ({ page }) => {
    /*
      ПРЕЖНЕЕ РЕШЕНИЕ ПАРТИИ 4–5 В СИЛЕ, и `TouchSensor` ему не противоречит.

      Замер: на 390px и на 834px в разметке ОДНА колонка и четыре вкладки —
      остальные колонки не нарисованы вовсе, бросать физически некуда. С 900px
      (`md`) колонки стоят рядом, и перенос включается.

      `TouchSensor` сделан не для телефона, а для широких СЕНСОРНЫХ устройств:
      планшет в альбомной (1024×768), моноблок на кухне, ноутбук с тачскрином.
      Там колонки видны все, и палец — единственный ввод.

      Сторож нужен потому, что связь неочевидна: сенсор регистрируется всегда, а
      не работает он лишь потому, что ветка с `DndContext` ниже `md` не
      рисуется. Уберут условие — перенос молча появится там, где бросать некуда.
    */
    await stand(page)
    await signInToTracker(page, CREDENTIALS)

    for (const [width, height, columns] of [
      [390, 844, 1],
      [834, 1112, 1],
      [900, 900, 4],
      [1440, 900, 4],
    ] as const) {
      await page.setViewportSize({ width, height })
      await waitForLayout(page)
      // На узком видна одна колонка за раз, и по умолчанию это первая («Новый»).
      // Заказ лежит в «Принят» — открываем его вкладку, иначе карточки нет в
      // разметке вовсе и мерить нечего.
      const tab = page.getByTestId('tracker-tab-accepted')
      if (await tab.count()) await tab.click()
      await expect(page.getByTestId('tracker-order-9100').first()).toBeVisible({ timeout: 20_000 })

      await expect(
        page.locator('[data-testid^="tracker-column-"]'),
        `на ${width}px колонок в разметке не ${columns}`,
      ).toHaveCount(columns)

      const cursor = await page
        .getByTestId('tracker-order-9100')
        .first()
        .evaluate((node) => getComputedStyle(node).cursor)
      if (columns === 1) {
        expect(cursor, `на ${width}px карточка приглашает тянуть, а бросать некуда`).not.toBe('grab')
      } else {
        expect(cursor, `на ${width}px карточка не приглашает тянуть`).toBe('grab')
      }
    }
  })

  test('ручка отделена от тапа: нажатие на карточку открывает подробности', async ({ page }) => {
    await stand(page)
    await signInToTracker(page, CREDENTIALS)
    const card = page.getByTestId('tracker-order-9100')
    await expect(card).toBeVisible({ timeout: 20_000 })

    // Тап по телу карточки — подробности, как и было.
    await card.getByText('№9100').click()
    await expect(page).toHaveURL(/\/tracker\/order\//)
  })
})

/**
 * ПЕРЕНОС ПАЛЬЦЕМ — на широком СЕНСОРНОМ экране.
 *
 * Ради чего заведён `TouchSensor`: планшет в альбомной ориентации, сенсорный
 * моноблок на кухне, ноутбук с тачскрином. Ниже `md` колонок одна и бросать
 * некуда — там жеста нет вовсе (сторож раскладки рядом).
 *
 * События касания шлются РУЧНУЮ: `page.touchscreen` умеет только тап, а нам
 * нужны удержание, протяжка и отпускание — то есть настоящая
 * последовательность `touchstart` → пауза → `touchmove` → `touchend`.
 */
test.describe('Доска: перенос пальцем', () => {
  test.use({ hasTouch: true, viewport: { width: 1200, height: 900 } })

  /** Последовательность касаний по элементу: удержать, протащить, отпустить. */
  async function touchDrag(
    page: Page,
    fromSelector: string,
    to: { x: number; y: number },
    { hold = 260, steps = 6 } = {},
  ): Promise<void> {
    await page.evaluate(
      async ({ selector, target, holdMs, stepCount }) => {
        const node = document.querySelector(selector)
        if (!node) throw new Error(`нет элемента ${selector}`)
        const box = node.getBoundingClientRect()
        const start = { x: box.left + box.width / 2, y: box.top + box.height / 2 }

        const touchAt = (x: number, y: number) =>
          new Touch({ identifier: 1, target: node, clientX: x, clientY: y })
        const fire = (type: string, x: number, y: number) => {
          const touch = touchAt(x, y)
          node.dispatchEvent(
            new TouchEvent(type, {
              bubbles: true,
              cancelable: true,
              touches: type === 'touchend' ? [] : [touch],
              targetTouches: type === 'touchend' ? [] : [touch],
              changedTouches: [touch],
            }),
          )
        }
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

        fire('touchstart', start.x, start.y)
        // УДЕРЖАНИЕ: активация настроена на 200 мс. Меньше — это тап.
        await wait(holdMs)
        for (let i = 1; i <= stepCount; i += 1) {
          fire(
            'touchmove',
            start.x + ((target.x - start.x) * i) / stepCount,
            start.y + ((target.y - start.y) * i) / stepCount,
          )
          await wait(16)
        }
        fire('touchend', target.x, target.y)
      },
      { selector: fromSelector, target: to, holdMs: hold, stepCount: steps },
    )
  }

  test('УКУС: удержание и протяжка пальцем переносят карточку и меняют статус', async ({
    page,
  }) => {
    const { moves } = await stand(page)
    await signInToTracker(page, CREDENTIALS)
    await expect(page.getByTestId('tracker-order-9100')).toBeVisible({ timeout: 20_000 })
    // Ширина больше `md`: колонки стоят рядом, бросать есть куда.
    await expect(page.locator('[data-testid^="tracker-column-"]')).toHaveCount(4)

    const target = (await page.getByTestId('tracker-column-preparing').boundingBox())!
    await touchDrag(page, '[data-testid="tracker-order-9100"]', {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    })

    await expect
      .poll(() => moves.map((m) => m.status), { timeout: 10_000 })
      .toEqual(['preparing'])
    await expect(
      page.getByTestId('tracker-column-preparing').getByTestId('tracker-order-9100'),
    ).toBeVisible()
  })

  test('УКУС: карточка не запрещает браузеру прокрутку (touch-action)', async ({ page }) => {
    /*
      ЧТО ЭТА ПРОВЕРКА ДОКАЗЫВАЕТ, А ЧТО НЕТ.

      `touch-action` исполняет ЖЕСТОВЫЙ ДВИЖОК БРАУЗЕРА, а не наш код. Настоящую
      прокрутку пальцем синтетическими `TouchEvent` не воспроизвести — они идут
      мимо движка, и проверка ниже (свайп без удержания) значение `touch-action`
      не чувствует вовсе: она краснеет на сломанной ЗАДЕРЖКЕ, но не на
      запрещённой прокрутке. Это выяснилось укусом: подмена `manipulation` на
      `none` её не уронила.

      Поэтому объявленное значение сторожится прямо. `none` здесь означает
      «браузер не листает доску пальцем», а прокрутка на кухонном экране нужнее
      переноса: карточек в колонке больше, чем помещается.
    */
    await stand(page)
    await signInToTracker(page, CREDENTIALS)
    const card = page.getByTestId('tracker-order-9100')
    await expect(card).toBeVisible({ timeout: 20_000 })

    const touchAction = await card.evaluate((node) => getComputedStyle(node).touchAction)
    expect(
      touchAction,
      'карточка запрещает браузеру жесты — доска перестанет листаться пальцем',
    ).not.toBe('none')
    expect(touchAction).toBe('manipulation')
  })

  test('УКУС: быстрый свайп по карточке НЕ начинает перенос', async ({
    page,
  }) => {
    /*
      Здесь проверяется ЗАДЕРЖКА, а не `touch-action` (см. соседнюю проверку):
      свайп уводит палец раньше, чем истекут 200 мс, и захват не наступает.
    */
    const { moves } = await stand(page)
    await signInToTracker(page, CREDENTIALS)
    await expect(page.getByTestId('tracker-order-9100')).toBeVisible({ timeout: 20_000 })

    const target = (await page.getByTestId('tracker-column-preparing').boundingBox())!
    // БЕЗ УДЕРЖАНИЯ: палец уходит сразу — это прокрутка, а не перенос.
    await touchDrag(
      page,
      '[data-testid="tracker-order-9100"]',
      { x: target.x + target.width / 2, y: target.y + target.height / 2 },
      { hold: 0, steps: 4 },
    )

    /*
      ПАУЗА ЗАКОННА: проверяется ОТСУТСТВИЕ переноса после свайпа. Ждать
      нечего — ждём как раз того, что ничего не произошло.
    */
    await page.waitForTimeout(1200)
    expect(moves, 'свайп по карточке уехал в перенос').toEqual([])
    await expect(
      page.getByTestId('tracker-column-accepted').getByTestId('tracker-order-9100'),
      'карточка уехала из своей колонки от простого свайпа',
    ).toBeVisible()
  })
})
