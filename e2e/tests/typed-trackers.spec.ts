import { expect, test, type Page } from '@playwright/test'

import {
  ADMIN,
  API,
  apiHeaders,
  apiToken,
  BARMAN,
  CREDENTIALS,
  DEMO_ROOM,
  loginToTracker,
  MAID,
  RESTAURANT_MANAGER,
  moveOrderTo,
  openCart,
} from './helpers'

/**
 * R3: типизированные трекеры и роль управляющего.
 *
 * Проверяем НОВЫЙ поток, а не «ничего не сломалось»:
 *   1. линейный повар ведёт заказ по доске ресторана;
 *   2. горничная берёт заявку в очереди хозслужбы и закрывает её;
 *   3. коктейль из разъехавшегося заказа рум-сервиса виден на доске БАРА —
 *      с пометкой, из какого гостевого заказа он приехал;
 *   4. управляющий рестораном не может тронуть чужой сервис и настройки отеля.
 */

async function enterAsGuest(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })
}

test.describe('Типизированные трекеры', () => {
  test('повар ведёт заказ по доске ресторана: новый → принят → готовится → доставлено', async ({
    browser,
  }) => {
    const guestContext = await browser.newContext()
    const staffContext = await browser.newContext()
    const guest = await guestContext.newPage()
    const staff = await staffContext.newPage()

    try {
      await loginToTracker(staff, CREDENTIALS)

      await enterAsGuest(guest)
      // К блюдам гость идёт ЧЕРЕЗ заведение: плоского меню отеля больше нет,
      // и путь теста совпадает с путём живого гостя — плитка на главной.
      await guest.getByTestId('guest-home-tile-kitchen').click()
      await expect(guest.getByTestId('guest-menu')).toBeVisible({ timeout: 15_000 })
      await guest.getByTestId('guest-qty-plus-caesar').click()
      await openCart(guest)
      await guest.getByTestId('guest-place-order').click()

      await expect(guest.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
      const number = (await guest.getByTestId('guest-order-number').innerText()).match(
        /\d+/,
      )?.[0] as string
      expect(number).toBeTruthy()

      // Колонки доски — из потока ресторана, а не из захардкоженного списка.
      const board = staff.getByTestId('tracker-board')
      await expect(staff.getByTestId(`tracker-order-${number}`)).toBeVisible({ timeout: 20_000 })

      await staff.getByTestId(`tracker-accept-${number}`).click()
      await expect(staff.getByTestId(`tracker-order-${number}`)).toContainText(/Принят/i, {
        timeout: 15_000,
      })

      await moveOrderTo(staff, number, 'preparing')
      await expect(staff.getByTestId(`tracker-order-${number}`)).toContainText(/Готовится/i, {
        timeout: 15_000,
      })

      await moveOrderTo(staff, number, 'done')
      // Завершённая карточка уходит с активной доски — это и есть «доставлено».
      await expect(staff.getByTestId(`tracker-order-${number}`)).toBeHidden({ timeout: 15_000 })
      await expect(board).toBeVisible()
    } finally {
      await guestContext.close()
      await staffContext.close()
    }
  })

  test('хозслужба: горничная берёт заявку в очереди и отмечает готово', async ({
    browser,
  }) => {
    const guestContext = await browser.newContext()
    const staffContext = await browser.newContext()
    const guest = await guestContext.newPage()
    const staff = await staffContext.newPage()

    try {
      await loginToTracker(staff, MAID)

      // У очереди хозслужбы свои колонки: ни «готовится», ни «в пути».
      await expect(staff.getByTestId('tracker-board')).toBeVisible()
      await expect(staff.getByTestId('tracker-tab-preparing')).toHaveCount(0)

      await enterAsGuest(guest)
      // Уборка — заявка ХОЗСЛУЖБЫ, а не консьержа: у каждой свой исполнитель и
      // своя доска, и заходить за ней гость должен в её заведение.
      await guest.goto('/venue/housekeeping')
      await expect(guest.getByTestId('guest-service-cleaning')).toBeVisible({ timeout: 15_000 })
      await guest.getByTestId('guest-service-cleaning').click()

      await expect(guest.getByTestId('guest-request-form')).toBeVisible()
      await expect(guest.getByTestId('guest-field-when')).toBeVisible()
      await guest.getByTestId('guest-field-when').fill('15:00')
      await guest.getByTestId('guest-request-submit').click()

      await expect(guest.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
      const number = (await guest.getByTestId('guest-order-number').innerText()).match(
        /\d+/,
      )?.[0] as string

      const card = staff.getByTestId(`tracker-order-${number}`)
      await expect(card).toBeVisible({ timeout: 20_000 })

      // «Взять на себя» ведёт сразу в «В работе» — у очереди нет промежуточного
      // «принят», работа начинается с того, что заявку кто-то забрал.
      await staff.getByTestId(`tracker-accept-${number}`).click()
      await expect(card).toContainText(/В работе/i, { timeout: 15_000 })

      await moveOrderTo(staff, number, 'done')
      await expect(staff.getByTestId(`tracker-order-${number}`)).toBeHidden({ timeout: 15_000 })
    } finally {
      await guestContext.close()
      await staffContext.close()
    }
  })

  test('коктейль из разъехавшегося заказа рум-сервиса виден на доске бара', async ({
    page,
    request,
  }) => {
    // Фикстуру разъезда собираем ЧЕРЕЗ ПУБЛИЧНЫЙ API — до R4 это было
    // невозможно: у маршрутов (категория → исполнитель) не было CMS-эндпоинта,
    // и созданная через админку категория оставалась без исполнителя. Из-за
    // этого тест и стоял в skip.
    const token = await apiToken(request, ADMIN)
    const h = apiHeaders(token)
    const tag = Date.now().toString(36)

    const services = (await request.get(`${API}/api/cms/services`, { headers: h }).then((r) =>
      r.json(),
    )) as Array<{ id: string; code: string }>
    const kitchen = services.find((s) => s.code === 'kitchen')!
    const bar = services.find((s) => s.code === 'bar')!
    const barPointId = (
      await request.get(`${API}/api/cms/services/${bar.id}`, { headers: h }).then((r) => r.json())
    ).execution_point.id

    // 1. Бару — свой раздел и коктейль в нём.
    const barCategory = await request
      .post(`${API}/api/cms/categories`, {
        data: { type: 'product', title: { ru: `Коктейли ${tag}` }, service_id: bar.id },
        headers: h,
      })
      .then((r) => r.json())

    // 2. Маршрут раздела на бар — ради этого эндпоинта R4 и заводился.
    await request.put(`${API}/api/cms/categories/${barCategory.id}/routes`, {
      data: { routes: [{ execution_point_id: barPointId }] },
      headers: h,
    })

    const cocktail = await request
      .post(`${API}/api/cms/items`, {
        data: {
          category_id: barCategory.id,
          type: 'product',
          title: { ru: `Негрони ${tag}` },
          price: 65000,
        },
        headers: h,
      })
      .then((r) => r.json())

    // 3. Сервис-агрегатор, включающий кухню и бар по ссылке (модель R2).
    const aggregator = await request
      .post(`${API}/api/cms/services`, {
        data: { type: 'room_service', public_name: { ru: `Рум-сервис ${tag}` } },
        headers: h,
      })
      .then((r) => r.json())

    for (const sourceId of [kitchen.id, bar.id]) {
      const included = await request.post(
        `${API}/api/cms/services/${aggregator.id}/inclusions`,
        { data: { source_service_id: sourceId }, headers: h },
      )
      expect(included.ok(), await included.text()).toBeTruthy()
    }

    // 4. Гость заказывает у агрегатора блюдо кухни и коктейль бара.
    const menuItems = (await request
      .get(`${API}/api/cms/items?service_id=${kitchen.id}`, { headers: h })
      .then((r) => r.json())) as Array<{ id: string; code: string }>
    const dish = menuItems.find((item) => item.code === 'caesar')!

    const session = await request.post(`${API}/api/guest/session`, {
      data: { room_number: DEMO_ROOM, language: 'ru' },
      headers: { 'X-Hotel-Subdomain': 'crystal' },
    })
    const guestToken = (await session.json()).token

    const placed = await request.post(`${API}/api/guest/order`, {
      data: {
        lines: [
          { item_id: dish.id, quantity: 1 },
          { item_id: cocktail.id, quantity: 1 },
        ],
        service_code: aggregator.code,
        timing: 'asap',
      },
      headers: {
        Authorization: `Bearer ${guestToken}`,
        'X-Hotel-Subdomain': 'crystal',
        'Idempotency-Key': `e2e-fanout-${tag}`,
      },
    })
    expect(placed.ok(), await placed.text()).toBeTruthy()
    const guestOrderNumber = (await placed.json()).number as number

    // Бармен видит СВОЙ суб-заказ — со своим номером и с пометкой источника.
    await loginToTracker(page, BARMAN)
    const source = page.locator('[data-testid^="tracker-source-"]', {
      hasText: `№${guestOrderNumber}`,
    })
    await expect(source.first()).toBeVisible({ timeout: 20_000 })
    await expect(source.first()).toContainText(/рум-сервис/i)

    // И на доске бара только коктейль: салат остался на кухне.
    const board = page.getByTestId('tracker-board')
    await expect(board).toContainText(new RegExp(`Негрони ${tag}`, 'i'))
    await expect(board).not.toContainText(/цезарь/i)
  })
})

test.describe('Роль управляющего сервисом', () => {
  test('линейного повара в раздел управления не пускают, но трекер у него есть', async ({
    page,
    request,
  }) => {
    // Работа на месте: доска своей точки открывается.
    await loginToTracker(page, CREDENTIALS)

    // Меню, цены и настройки — нет. Отказ по РОЛИ, а не по токену: код говорит
    // «не хватает роли», и перелогин тут ничего не изменит.
    const chef = await apiToken(request, CREDENTIALS)
    for (const path of ['/api/cms/items', '/api/cms/brand', '/api/cms/staff']) {
      const response = await request.get(`${API}${path}`, { headers: apiHeaders(chef) })
      expect(response.status(), path).toBe(403)
      expect((await response.json()).code, path).toBe('no_cms_access')
    }
  })

  test('управляющий правит своё меню, но не чужой сервис и не настройки отеля', async ({
    request,
  }) => {
    const manager = await apiToken(request, RESTAURANT_MANAGER)
    const admin = await apiToken(request, ADMIN)
    const headers = apiHeaders(manager)

    // Своё меню — видит и правит.
    const mine = await request.get(`${API}/api/cms/items`, { headers })
    expect(mine.ok()).toBeTruthy()
    const items = (await mine.json()) as Array<{ id: string; code: string; price: number }>
    const caesar = items.find((item) => item.code === 'caesar')
    expect(caesar, 'управляющий рестораном должен видеть своё меню').toBeTruthy()

    const edited = await request.patch(`${API}/api/cms/items/${caesar!.id}`, {
      data: { price: caesar!.price },
      headers,
    })
    expect(edited.ok(), await edited.text()).toBeTruthy()

    // Чужой сервис — не видит в списке и не достаёт по прямому id.
    const foreignTree = await request.get(
      `${API}/api/cms/categories?type=service_request`,
      { headers },
    )
    expect((await foreignTree.json()).length).toBe(0)

    const allForeign = await request.get(`${API}/api/cms/categories?type=service_request`, {
      headers: apiHeaders(admin),
    })
    const transfer = ((await allForeign.json()) as Array<{ id: string; code: string }>).find(
      (node) => node.code === 'transfer',
    )
    expect(transfer, 'у консьержа есть свой раздел заявок').toBeTruthy()

    const stolen = await request.patch(`${API}/api/cms/categories/${transfer!.id}`, {
      data: { is_active: false },
      headers,
    })
    expect(stolen.status()).toBe(403)
    expect((await stolen.json()).code).toBe('not_my_service')

    // Настройки отеля — тоже мимо.
    for (const path of ['/api/cms/brand', '/api/cms/commerce-settings']) {
      const hotelLevel = await request.patch(`${API}${path}`, { data: {}, headers })
      expect(hotelLevel.status(), path).toBe(403)
      expect((await hotelLevel.json()).code, path).toBe('hotel_admin_only')
    }
  })
})
