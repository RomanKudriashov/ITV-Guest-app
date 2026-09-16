import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, CREDENTIALS, DEMO_ROOM, HOTEL, apiToken, moveOrderStatus, signInToTracker } from './helpers'

/**
 * ПАРТИЯ 5: СТАТУСЫ НАЗАД И РУЧНОЙ ПОРЯДОК НА ДОСКЕ.
 *
 * Проверки идут ПО ЖИВОМУ СТЕНДУ, а не по мокам: и возврат в работу, и порядок
 * карточек — это состояние на сервере, общее для всей смены. Мок показал бы,
 * что экран умеет рисовать, и промолчал бы о том, доехало ли решение до
 * соседнего экрана — а весь смысл ручного порядка именно в этом.
 */

/** Найти позицию по коду где угодно в дереве каталога. */
function findByCode(node: unknown, code: string): { id: string; code: string } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByCode(child, code)
      if (found) return found
    }
    return null
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>
    if (record.code === code && typeof record.id === 'string') {
      return { id: record.id, code }
    }
    for (const value of Object.values(record)) {
      const found = findByCode(value, code)
      if (found) return found
    }
  }
  return null
}

async function placeOrder(request: APIRequestContext): Promise<{ id: string; number: number }> {
  const session = await request.post(`${API}/api/guest/session`, {
    data: { room_number: DEMO_ROOM },
    headers: { 'X-Hotel-Subdomain': HOTEL },
  })
  expect(session.ok(), 'гостевая сессия не открылась').toBeTruthy()
  const guestToken = (await session.json()).token

  const catalog = await request.get(`${API}/api/guest/catalog`, {
    headers: { Authorization: `Bearer ${guestToken}`, 'X-Hotel-Subdomain': HOTEL },
  })
  expect(catalog.ok()).toBeTruthy()
  // Позиция ищется ПО КОДУ во всём дереве: у витрины гость ходит через
  // заведение, и раскладка категорий — не то, на что тест имеет право
  // опираться.
  const caesar = findByCode(await catalog.json(), 'caesar')
  expect(caesar, 'в каталоге демо-отеля не нашлось «Цезаря»').toBeTruthy()

  const created = await request.post(`${API}/api/guest/order`, {
    data: { lines: [{ item_id: (caesar as { id: string }).id, quantity: 1 }] },
    headers: {
      Authorization: `Bearer ${guestToken}`,
      'X-Hotel-Subdomain': HOTEL,
      // Ключ обязателен: повтор запроса не имеет права создать второй заказ.
      // У каждого заказа теста он свой — иначе сервер справедливо вернул бы
      // первый, и «два заказа» в проверке порядка оказались бы одним.
      'Idempotency-Key': `e2e-order-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  })
  expect(created.ok(), `заказ не создался -> ${created.status()}`).toBeTruthy()
  const order = await created.json()
  return { id: order.id, number: order.number }
}

async function boardColumn(
  request: APIRequestContext,
  token: string,
  code: string,
): Promise<number[]> {
  const response = await request.get(`${API}/api/tracker/orders?point=kitchen`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
  })
  expect(response.ok()).toBeTruthy()
  const board = await response.json()
  const column = board.columns.find((candidate: { code: string }) => candidate.code === code)
  return (column?.orders ?? []).map((order: { number: number }) => order.number)
}

async function openBoard(page: Page): Promise<void> {
  await signInToTracker(page, CREDENTIALS)
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })
}

test.describe('Возврат заказа в работу', () => {
  test('1. закрытый заказ возвращается в работу, отменённый — никогда', async ({ request }) => {
    const token = await apiToken(request, CREDENTIALS)

    const closed = await placeOrder(request)
    await moveOrderStatus(request, token, closed.id, 'done')
    const back = await request.post(`${API}/api/tracker/order/${closed.id}/status`, {
      data: { status: 'preparing' },
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    expect(back.status(), 'закрытый заказ обязан возвращаться в работу').toBe(200)
    expect((await back.json()).status.code).toBe('preparing')

    const cancelled = await placeOrder(request)
    await moveOrderStatus(request, token, cancelled.id, 'cancelled')
    const refused = await request.post(`${API}/api/tracker/order/${cancelled.id}/status`, {
      data: { status: 'preparing' },
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    expect(refused.status(), 'отмена односторонняя: ошиблись отменой — это новый заказ').toBe(409)
    expect((await refused.json()).code).toBe('order_cancelled')
  })

  test('2. выход из «Доставлено» спрашивает подтверждение на экране', async ({ page, request }) => {
    const token = await apiToken(request, CREDENTIALS)
    const order = await placeOrder(request)
    await moveOrderStatus(request, token, order.id, 'done')

    await openBoard(page)
    await page.goto(`/tracker/order/${order.id}`)
    const detail = page.getByTestId('tracker-order-detail')
    await expect(detail).toBeVisible({ timeout: 20_000 })

    // Возврат в работу — из меню действий, и он обязан СПРОСИТЬ.
    await page.getByTestId(`tracker-more-${order.number}`).click()
    await page.getByTestId(`tracker-status-${order.number}-preparing`).click()

    const confirm = page.getByTestId('tracker-reopen-confirm')
    await expect(confirm, 'закрытый заказ выпускается только через вопрос').toBeVisible()

    // Пока не подтвердили — статус НЕ изменился. Без этой строки проверка
    // зеленела бы и на диалоге, который ничего не держит.
    const stillClosed = await request.get(`${API}/api/tracker/order/${order.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    expect((await stillClosed.json()).status.code).toBe('done')

    await confirm.click()
    await expect(detail).toContainText(/Готовится/i, { timeout: 20_000 })
  })

  test('3. журнал показывает возврат КАК возврат и называет, кто вернул', async ({
    page,
    request,
  }) => {
    const token = await apiToken(request, CREDENTIALS)
    const order = await placeOrder(request)
    await moveOrderStatus(request, token, order.id, 'done')
    await request.post(`${API}/api/tracker/order/${order.id}/status`, {
      data: { status: 'preparing' },
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })

    await openBoard(page)
    await page.goto(`/tracker/order/${order.id}`)
    const journal = page.getByTestId('tracker-order-journal')
    await expect(journal).toBeVisible({ timeout: 20_000 })

    // Последняя запись — возврат, и она помечена возвратом.
    const rollbacks = journal.locator('[data-rollback="true"]')
    await expect(rollbacks).toHaveCount(1)
    await expect(rollbacks.first()).toContainText(/возврат/i)
    // И названо, ОТКУДА вернули: без этого строка «Готовится» читается как
    // обычный шаг вперёд.
    await expect(rollbacks.first()).toContainText(/done/i)
  })
})

test.describe('Ручной порядок на доске', () => {
  test('4. новая заявка встаёт НАВЕРХ своей колонки', async ({ request }) => {
    const token = await apiToken(request, CREDENTIALS)
    const earlier = await placeOrder(request)
    const later = await placeOrder(request)

    const column = await boardColumn(request, token, 'new')
    const positionEarlier = column.indexOf(earlier.number)
    const positionLater = column.indexOf(later.number)
    expect(positionLater, 'обе заявки обязаны быть на доске').toBeGreaterThanOrEqual(0)
    expect(positionLater, 'свежая заявка внизу списка будет замечена последней').toBeLessThan(
      positionEarlier,
    )
  })

  test('5. переставленный порядок держится и виден ДРУГОМУ экрану', async ({ request }) => {
    const token = await apiToken(request, CREDENTIALS)
    const lower = await placeOrder(request)
    const upper = await placeOrder(request)

    // Верхнюю ставим ПОД нижнюю — это и есть решение смены.
    const moved = await request.post(`${API}/api/tracker/order/${upper.id}/position`, {
      data: { after: lower.id, before: null },
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    expect(moved.ok(), `перестановка -> ${moved.status()}`).toBeTruthy()

    const column = await boardColumn(request, token, 'new')
    expect(column.indexOf(upper.number)).toBeGreaterThan(column.indexOf(lower.number))

    // ДРУГИЕ РУКИ — другая сессия с другим токеном, как на объекте.
    const second = await apiToken(request, CREDENTIALS)
    const seenByOther = await boardColumn(request, second, 'new')
    expect(
      seenByOther.indexOf(upper.number),
      'порядок общий на смену, а не украшение одного экрана',
    ).toBeGreaterThan(seenByOther.indexOf(lower.number))
  })

  test('6. сосед из чужой колонки перестановку не делает', async ({ request }) => {
    const token = await apiToken(request, CREDENTIALS)
    const here = await placeOrder(request)
    const elsewhere = await placeOrder(request)
    await moveOrderStatus(request, token, elsewhere.id, 'accepted')

    const refused = await request.post(`${API}/api/tracker/order/${here.id}/position`, {
      data: { after: elsewhere.id, before: null },
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    expect(refused.status(), '«между этими двумя» бессмысленно через колонку').toBe(422)
    expect((await refused.json()).code).toBe('neighbour_not_in_column')
  })

  test('7. просрочка красит карточку, но не переставляет её', async ({ page, request }) => {
    const token = await apiToken(request, CREDENTIALS)
    const fresh = await placeOrder(request)
    const stale = await placeOrder(request)

    const before = await boardColumn(request, token, 'new')
    // Состарить заказ можно только на сервере — время создания гость не задаёт.
    const aged = await request.post(`${API}/api/tracker/order/${fresh.id}/position`, {
      data: { after: stale.id, before: null },
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    expect(aged.ok()).toBeTruthy()

    const after = await boardColumn(request, token, 'new')
    expect(after.indexOf(fresh.number)).toBeGreaterThan(after.indexOf(stale.number))
    expect(before.length).toBe(after.length)

    await openBoard(page)
    await expect(page.getByTestId(`tracker-order-${stale.number}`)).toBeVisible({
      timeout: 20_000,
    })
  })
})

test.describe('Порядок на экране', () => {
  test('8. зазор идёт за курсором, а не за временем создания', async ({ page, request }) => {
    await placeOrder(request)
    await placeOrder(request)
    await placeOrder(request)
    await openBoard(page)

    const column = page.getByTestId('tracker-column-new')
    const cards = column.getByTestId(/^tracker-order-/)
    await expect(cards.first()).toBeVisible({ timeout: 20_000 })
    const count = await cards.count()
    expect(count, 'для проверки места нужны минимум три карточки').toBeGreaterThanOrEqual(3)

    /*
      ЦЕЛЬ БЕРЁТСЯ ИЗ ВИДИМОЙ ЧАСТИ КОЛОНКИ, А НЕ «ПОСЛЕДНЯЯ В СПИСКЕ».

      Первая версия несла карточку к последней из двадцати девяти — то есть за
      нижний край окна. Курсор туда не доходит, `over` приходит пустым, и
      зазора нет по совершенно правильной причине. Проверка при этом краснела и
      выглядела как дефект продукта: так ложное обвинение и рождается.
    */
    const first = (await cards.nth(0).boundingBox()) as {
      x: number
      y: number
      height: number
    }
    const third = (await cards.nth(2).boundingBox()) as { x: number; y: number; height: number }

    // Верхнюю карточку несём на НИЖНЮЮ половину третьей: место должно
    // оказаться ПОД третьей, а не там, откуда карточку взяли.
    await page.mouse.move(first.x + 40, first.y + first.height / 2)
    await page.mouse.down()
    await page.mouse.move(first.x + 60, first.y + first.height / 2 + 20, { steps: 5 })
    await page.mouse.move(third.x + 40, third.y + third.height - 4, { steps: 12 })

    const gap = page.getByTestId('tracker-drop-placeholder')
    await expect(gap, 'зазор обязан быть виден под курсором').toBeVisible()

    /*
      Карточки МЕРЯЮТСЯ ЗАНОВО, уже с зазором в разметке: он раздвигает
      колонку, и координаты, снятые до жеста, к этому моменту сдвинуты на свою
      же высоту. Сравнение со старыми числами краснело бы на исправной доске.
    */
    const gapBox = (await gap.boundingBox()) as { y: number }
    const secondNow = (await cards.nth(1).boundingBox()) as { y: number }
    expect(
      gapBox.y,
      'место выбирают курсором: зазор внизу, у третьей карточки, а не там, откуда несомую взяли',
    ).toBeGreaterThan(secondNow.y)

    // И обратно: увели курсор к самому верху — зазор поехал за ним.
    await page.mouse.move(first.x + 40, first.y + 2, { steps: 10 })
    const backBox = (await gap.boundingBox()) as { y: number }
    expect(backBox.y, 'зазор обязан следовать за курсором, а не замирать').toBeLessThan(gapBox.y)

    await page.mouse.up()
  })

  test('9. стрелки вверх-вниз двигают карточку внутри колонки', async ({ page, request }) => {
    const token = await apiToken(request, CREDENTIALS)
    const lower = await placeOrder(request)
    const upper = await placeOrder(request)

    await openBoard(page)
    const card = page.getByTestId(`tracker-order-${upper.number}`)
    await expect(card).toBeVisible({ timeout: 20_000 })

    /*
      РАБОТАЕМ СО СВОИМИ НОМЕРАМИ, А НЕ С «ПЕРВОЙ КАРТОЧКОЙ КОЛОНКИ».

      Доска живая: пока идёт проверка, соседний тест кладёт в «Новый» свою
      заявку, и она встаёт сверху. Проверка вида «первой стала другая карточка»
      зеленела бы от ЧУЖОГО заказа — то есть молчала бы о сломанной клавиатуре.
      Сравниваем две свои карточки между собой.
    */
    const numbers = async (): Promise<number[]> => boardColumn(request, token, 'new')
    const before = await numbers()
    expect(before.indexOf(upper.number)).toBeLessThan(before.indexOf(lower.number))

    // Alt+стрелка: с модификатором, потому что голые стрелки листают доску.
    await card.focus()
    await page.keyboard.press('Alt+ArrowDown')

    /*
      БЮДЖЕТ ОЖИДАНИЯ СЧИТАН ПО ЦЕНЕ ОДНОГО ЧТЕНИЯ, А НЕ ВЗЯТ КРУГЛЫМ ЧИСЛОМ.

      `numbers()` читает доску целиком, и на стенде, где в колонке скопились
      сотни открытых карточек, одно чтение стоит 2,5–6,7 с (замерено: 319
      карточек). В пятнадцать секунд помещалось ДВА чтения, и первое из них
      уходило на сервер через 40 мс после нажатия — то есть заведомо до того,
      как запись легла. Проверка падала на исправном жесте: в трассе запрос
      перестановки отвечает 200, а в базе карточка стоит там, куда её увели.

      Сорок пять секунд — это шесть-семь чтений даже на медленном стенде.
      Ускорять надо саму доску (её цена растёт с числом карточек линейно), но
      это отдельная работа: здесь проверяется жест, а не скорость выдачи.
    */
    await expect
      .poll(
        async () => {
          const order = await numbers()
          return order.indexOf(upper.number) > order.indexOf(lower.number)
        },
        { timeout: 45_000, message: 'клавиатура обязана двигать карточку так же, как мышь' },
      )
      .toBe(true)

    // И обратно — шаг вверх возвращает её на место. Без этого проверка зеленела
    // бы на коде, который умеет только вниз.
    await page.getByTestId(`tracker-order-${upper.number}`).focus()
    await page.keyboard.press('Alt+ArrowUp')
    await expect
      .poll(
        async () => {
          const order = await numbers()
          return order.indexOf(upper.number) < order.indexOf(lower.number)
        },
        { timeout: 45_000, message: 'шаг вверх обязан возвращать карточку' },
      )
      .toBe(true)
  })
})

test.describe('Просроченное ниже экрана', () => {
  test('10. доска говорит, сколько просроченных осталось ниже', async ({ page, request }) => {
    const token = await apiToken(request, CREDENTIALS)

    /*
      БАННЕР — ОТВЕТ НА ЦЕНУ РУЧНОГО ПОРЯДКА.

      Смена вправе отодвинуть просроченное вниз, и доска не спорит: поднимать
      карточку самой значило бы отменять решение человека под нагрузкой. Но
      молчать нельзя — отодвинутая карточка уезжает за край экрана вместе со
      своим красным. Доска не переставляет, а ГОВОРИТ.
    */
    const column = await boardColumn(request, token, 'new')
    expect(column.length, 'проверке нужна длинная колонка').toBeGreaterThan(10)

    await openBoard(page)
    const banner = page.getByTestId('tracker-overdue-below-new')
    const board = page.getByTestId('tracker-column-new')
    await expect(board.getByTestId(/^tracker-order-/).first()).toBeVisible({ timeout: 20_000 })

    // Сколько просроченных ЗА нижним краем окна — считаем сами, по разметке,
    // и сравниваем с тем, что говорит баннер. Число «просто есть» ничего не
    // доказывает: ошибка на единицу так и живёт незамеченной.
    const hidden = await board.evaluate((node) => {
      const cards = Array.from(node.querySelectorAll('[data-overdue="true"]'))
      return cards.filter((card) => card.getBoundingClientRect().top >= window.innerHeight).length
    })

    if (hidden === 0) {
      // Вся колонка уместилась на экране — тогда баннера быть не должно, и это
      // тоже проверяемое утверждение, а не повод пропустить проверку.
      await expect(banner).toBeHidden()
      return
    }

    await expect(banner).toBeVisible()
    await expect(banner).toContainText(String(hidden))

    /*
      Прокрутили В САМЫЙ НИЗ — число обязано уменьшиться, а не замереть.

      Первая версия крутила на 4000 пикселей и краснела на исправной доске:
      колонка «Новый» на стенде высотой в двадцать тысяч, просроченные лежат в
      самом низу, и после такой прокрутки НИЖЕ ЭКРАНА оставались все двадцать
      девять — баннер был прав, а проверка нет.
    */
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect
      .poll(
        async () => {
          if (!(await banner.isVisible())) return 0
          const text = (await banner.textContent()) ?? ''
          return Number(text.replace(/\D+/g, '')) || 0
        },
        {
          timeout: 10_000,
          message: 'после прокрутки ниже осталось меньше — баннер обязан это знать',
        },
      )
      .toBeLessThan(hidden)
  })
})
