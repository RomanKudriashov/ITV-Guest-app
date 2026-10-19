import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, CREDENTIALS, DEMO_ROOM, signInToCms, signInToTracker } from './helpers'

/**
 * ВСПЛЫВАЮЩИЕ КАРТОЧКИ СУЩНОСТЕЙ (партия 59а): заказ, номер, заведение.
 *
 * Механика — та, что утверждена в разведке: наведение на имя (ПК) открывает
 * карточку, клик остаётся тем, чем был (раскрыть строку, открыть шторку), Esc
 * закрывает; на телефоне нажатие — лист снизу, в портале (без портала лист
 * запирался в стеклянной строке); перетаскиванию на доске карточка не мешает.
 */

const CARD = (type: string) => `entity-card-${type}`

async function hoverAndWait(page: Page, testIdOrLocator: ReturnType<Page['getByTestId']>, type: string) {
  await testIdOrLocator.scrollIntoViewIfNeeded()
  await testIdOrLocator.hover()
  const card = page.getByTestId(CARD(type))
  await expect(card, 'карточка не всплыла на наведение').toBeVisible({ timeout: 5_000 })
  return card
}

test.describe('Карточки на ПК (1440)', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('заказ в списке CMS: наведение — карточка, Esc — закрыть, клик — строка раскрывается, как было', async ({ page }) => {
    await signInToCms(page, ADMIN)
    await page.goto('/cms/orders')
    const name = page.locator('[data-testid^="orders-row-name-"]').first()
    await expect(name).toBeVisible({ timeout: 20_000 })
    const number = ((await name.getAttribute('data-testid')) ?? '').replace('orders-row-name-', '')

    const card = await hoverAndWait(page, name, 'order')
    await expect(card.getByTestId('entity-card-title')).toContainText(`№ ${number}`)
    await expect(card.getByTestId('entity-card-status')).toBeVisible()
    await expect(card.getByTestId('entity-card-stages')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(card).toBeHidden()

    // Клик по имени — то, что было: раскрыть строку, без перехода.
    await name.click()
    await expect(page.getByTestId(`orders-detail-${number}`)).toBeVisible()
    await expect(page).toHaveURL(/\/cms\/orders/)
  })

  test('номер в списке CMS: значки и счёт, без данных гостя', async ({ page }) => {
    await signInToCms(page, ADMIN)
    await page.goto('/cms/orders')
    const room = page.locator('[data-testid^="orders-row-room-"]').first()
    await expect(room).toBeVisible({ timeout: 20_000 })
    const card = await hoverAndWait(page, room, 'room')
    await expect(card.getByTestId('entity-card-signs')).toBeVisible()
    await expect(card.getByTestId('entity-card-hero')).toBeVisible()
    // Карточка мыши не боится: увели курсор на неё — не гаснет.
    await card.hover()
    await page.waitForTimeout(400)
    await expect(card).toBeVisible()
  })

  test('заведение на экране «Сервисы»: фото полосой, статус часов, загрузка точки', async ({ page }) => {
    await signInToCms(page, ADMIN)
    await page.goto('/cms/services')
    const name = page.getByTestId('services-card-name-bar')
    await expect(name).toBeVisible({ timeout: 20_000 })
    const card = await hoverAndWait(page, name, 'venue')
    await expect(card.getByTestId('entity-card-status')).toBeVisible()
    await expect(card.getByTestId('entity-card-primary')).toHaveAttribute('href', /\/tracker\?point=bar/)
  })

  test('номерной фонд: кубик сетки показывает карточку номера, клик — панель номера', async ({ page }) => {
    await signInToCms(page, ADMIN)
    await page.goto('/cms/rooms?view=grid')
    const cube = page.locator('[data-entity-name="room"]').first()
    await expect(cube).toBeAttached({ timeout: 20_000 })
    const target = cube.locator('xpath=./*[1]')
    await target.hover()
    await expect(page.getByTestId(CARD('room'))).toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Доска трекера (1440)', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('номер заказа на доске: наведение — карточка, клик — шторка заказа, как было', async ({ page }) => {
    await signInToTracker(page, CREDENTIALS)
    const name = page.locator('[data-testid^="tracker-card-name-"]').first()
    await expect(name).toBeVisible({ timeout: 20_000 })
    await hoverAndWait(page, name, 'order')
    await name.click()
    await expect(page).toHaveURL(/\/tracker\/order\//, { timeout: 10_000 })
  })

  test('перетаскиванию карточка не мешает: гаснет на время жеста, бросок проходит', async ({ page }) => {
    const ORDER_ID = '22222222-2222-2222-2222-222222222222'
    const POINT = { id: '11111111-1111-1111-1111-111111111111', code: 'kitchen', title: 'Кухня', kind: 'kitchen', sla_minutes: 20, tracker_type: 'board', layout: 'columns' }
    const order = (code: string, title: string) => ({
      id: ORDER_ID,
      number: 9100,
      type: 'cart',
      status: { code, title, color_token: 'info' },
      status_flow: [],
      history: [],
      room: DEMO_ROOM,
      location: null,
      delivery_mode: 'delivery',
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
    })
    // Второй заказ — в колонке цели: во время жеста курсор проходит над его
    // номером, и без гашения там всплыла бы карточка.
    const other = { ...order('preparing', 'Готовится'), id: '33333333-3333-3333-3333-333333333333', number: 9101 }
    let placement: Record<string, unknown[]> = { accepted: [order('accepted', 'Принят')], preparing: [other] }
    const columns = ['new', 'accepted', 'preparing']
    const board = () =>
      JSON.stringify({
        point: POINT,
        scope: 'active',
        server_time: new Date().toISOString(),
        tracker_type: 'board',
        layout: 'columns',
        columns: columns.map((code) => ({ code, title: code, color_token: 'info', orders: placement[code] ?? [] })),
        next_cursor: null,
        shift: { new: 0, in_work: 1, overdue: 0, done: 0, median_minutes: null, median_accept_minutes: null, shift_started_at: new Date().toISOString(), sla_minutes: 20, last_order_at: null },
        assignees: [],
      })
    const moves: string[] = []
    await page.routeWebSocket('**/ws/**', (ws) => ws.close())
    await page.route('**/api/v1/tracker/orders**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: board() }))
    await page.route('**/api/v1/tracker/order/*/status', async (route) => {
      const status = (route.request().postDataJSON() as { status: string }).status
      moves.push(status)
      placement = { [status]: [order(status, status), other] }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order(status, status)) })
    })
    await page.route(`**/api/v1/cards/order/${ORDER_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'order', id: ORDER_ID, number: 9100, room: DEMO_ROOM, location: null, delivery_mode: 'delivery',
          venue: { id: POINT.id, code: 'kitchen', title: 'Кухня' },
          status: { code: 'accepted', title: 'Принят', color_token: 'info', is_terminal: false, is_cancelled: false },
          stages: [{ code: 'new', title: 'Новый', current: false }, { code: 'accepted', title: 'Принят', current: true }],
          due_at: '21:29', due_in_minutes: 12, lines: [{ title: 'Борщ', quantity: 1 }], lines_more: 0,
          total: 100000, currency: 'RUB', assignee: null, next_statuses: [{ code: 'preparing', title: 'Готовится' }],
          rights: { move: true, assign: true },
        }),
      }),
    )

    await signInToTracker(page, CREDENTIALS)
    const name = page.getByTestId('tracker-card-name-9100')
    await expect(name).toBeVisible({ timeout: 20_000 })
    await hoverAndWait(page, name, 'order')

    // Жест с ручки: карточка гаснет и не возвращается, пока тащат.
    const grip = page.getByTestId('tracker-grip-9100')
    await grip.hover()
    await page.mouse.down()
    const otherName = page.getByTestId('tracker-card-name-9101')
    const nameBox = (await otherName.boundingBox())!
    await page.mouse.move(nameBox.x + nameBox.width / 2, nameBox.y + nameBox.height / 2, { steps: 12 })
    // Дольше задержки открытия: без гашения карточка 9101 уже всплыла бы.
    await page.waitForTimeout(900)
    await expect(page.getByTestId(CARD('order'))).toHaveCount(0)
    const target = page.getByTestId('tracker-column-preparing')
    const box = (await target.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20, { steps: 6 })
    await page.mouse.up()

    await expect.poll(() => moves).toEqual(['preparing'])
  })
})

test.describe('Карточки на телефоне (390)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('нажатие на номер в списке заказов — лист снизу, строка не раскрывается; нажатие мимо — закрыть', async ({ page }) => {
    await signInToCms(page, ADMIN)
    await page.goto('/cms/orders')
    const room = page.locator('[data-testid^="orders-row-room-"]').first()
    await expect(room).toBeVisible({ timeout: 20_000 })
    const number = ((await room.getAttribute('data-testid')) ?? '').replace('orders-row-room-', '')
    await room.tap()

    const sheet = page.getByTestId('entity-sheet')
    await expect(sheet).toBeVisible()
    const card = sheet.getByTestId(CARD('room'))
    await expect(card).toBeVisible({ timeout: 5_000 })
    // Лист — у нижнего края экрана, а не внутри стеклянной строки.
    const rect = (await card.boundingBox())!
    expect(Math.round(rect.y + rect.height)).toBeGreaterThanOrEqual(844 - 2)
    expect(Math.round(rect.width)).toBeGreaterThanOrEqual(388)
    await expect(page.getByTestId(`orders-detail-${number}`)).toHaveCount(0)

    await sheet.click({ position: { x: 20, y: 20 } })
    await expect(sheet).toBeHidden()
  })
})
