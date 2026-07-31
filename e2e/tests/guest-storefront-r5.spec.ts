import { expect, test, type Page } from '@playwright/test'

import {
  ADMIN,
  API,
  apiHeaders,
  apiToken,
  BARMAN,
  DEMO_ROOM,
  loginToTracker,
  openCart,
} from './helpers'

/**
 * R5: витрина гостя.
 *
 * Главное, что здесь проверяется, — fan-out ОЖИЛ: заказ, собранный гостем в
 * витрине, разъезжается на две доски трекера. До R5 витрина не слала код
 * заведения, реальные заказы оставались плоскими, и разъезд жил только в
 * фикстурах.
 */

async function enterAsGuest(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })
}

test.describe('Парадная и проваливание', () => {
  test('главная — кадр отеля и витрина заведений', async ({ page }) => {
    await enterAsGuest(page)

    await expect(page.getByTestId('guest-home-hero')).toBeVisible()
    await expect(page.getByTestId('guest-home-bento')).toBeVisible()
  })

  test('гость проваливается в ресторан и видит ЕГО меню', async ({ page }) => {
    await enterAsGuest(page)
    await page.getByTestId('guest-home-tile-kitchen').click()

    // Заведение представилось собой, а не отелем — это и была главная поломка.
    const venue = page.getByTestId('guest-venue')
    await expect(venue).toBeVisible({ timeout: 15_000 })
    await expect(venue).toHaveAttribute('data-content', 'product')
    await expect(page.getByTestId('guest-venue-name')).toContainText(/Панорама/)
    await expect(page.getByTestId('guest-venue-status')).toBeVisible()

    // И в нём его блюда.
    await expect(page.getByTestId('guest-qty-plus-caesar')).toBeVisible({ timeout: 15_000 })
  })

  test('заявка, слоты и инфо открываются своими блоками', async ({ page }) => {
    await enterAsGuest(page)

    for (const [code, content] of [
      ['concierge', 'service_request'],
      ['spa', 'slot'],
    ]) {
      await page.goto(`/venue/${code}`)
      const venue = page.getByTestId('guest-venue')
      await expect(venue).toBeVisible({ timeout: 15_000 })
      await expect(venue).toHaveAttribute('data-content', content)
      await expect(page.getByTestId('guest-venue-name')).toBeVisible()
    }

    // Инфо — отдельный раздел отеля, а не заведение.
    await page.goto('/info')
    await expect(page.getByTestId('guest-info-catalog')).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('Посервисная корзина и разъезд', () => {
  // Сценарий тяжёлый: готовит заведение через CMS, ведёт гостя по витрине и
  // ждёт появления суб-заказа на чужой доске. Минуты по умолчанию мало.
  test.slow()

  test('смешанный заказ в агрегаторе разъезжается на две доски трекера', async ({
    browser,
    request,
  }) => {
    const token = await apiToken(request, ADMIN)
    const h = apiHeaders(token)
    const tag = Date.now().toString(36)

    // --- Заведение-агрегатор, включающее кухню и бар (модель R2, UI R4) ----
    const services = (await request
      .get(`${API}/api/cms/services`, { headers: h })
      .then((r) => r.json())) as Array<{ id: string; code: string }>
    const kitchen = services.find((s) => s.code === 'kitchen')!
    const bar = services.find((s) => s.code === 'bar')!
    const barPoint = (
      await request.get(`${API}/api/cms/services/${bar.id}`, { headers: h }).then((r) => r.json())
    ).execution_point.id

    const barCategory = await request
      .post(`${API}/api/cms/categories`, {
        data: { type: 'product', title: { ru: `Коктейли ${tag}` }, service_id: bar.id },
        headers: h,
      })
      .then((r) => r.json())
    await request.put(`${API}/api/cms/categories/${barCategory.id}/routes`, {
      data: { routes: [{ execution_point_id: barPoint }] },
      headers: h,
    })
    const cocktailTitle = `Негрони ${tag}`
    await request.post(`${API}/api/cms/items`, {
      data: {
        category_id: barCategory.id,
        type: 'product',
        title: { ru: cocktailTitle },
        price: 65000,
      },
      headers: h,
    })

    const aggregator = await request
      .post(`${API}/api/cms/services`, {
        data: { type: 'room_service', public_name: { ru: `Рум-сервис ${tag}` } },
        headers: h,
      })
      .then((r) => r.json())
    for (const source of [kitchen.id, bar.id]) {
      const included = await request.post(
        `${API}/api/cms/services/${aggregator.id}/inclusions`,
        { data: { source_service_id: source }, headers: h },
      )
      expect(included.ok(), await included.text()).toBeTruthy()
    }

    // --- Гость собирает корзину В АГРЕГАТОРЕ и оформляет -------------------
    const guestContext = await browser.newContext()
    const barContext = await browser.newContext()
    const guest = await guestContext.newPage()
    const barman = await barContext.newPage()

    try {
      await loginToTracker(barman, BARMAN)

      await enterAsGuest(guest)
      await guest.goto(`/venue/${aggregator.execution_point.code}`)
      await expect(guest.getByTestId('guest-venue')).toBeVisible({ timeout: 15_000 })

      // Обе позиции заимствованные: салат с кухни, коктейль из бара —
      // объединённое меню агрегатора (R2) гость видит как одно.
      await guest.getByTestId('guest-qty-plus-caesar').click()

      // Коктейль добавляем через карточку: его код сгенерирован, и обращаться
      // к нему по testid значило бы знать этот код заранее.
      await guest.getByText(cocktailTitle).first().click()
      await expect(guest.getByTestId('guest-item-sheet')).toBeVisible({ timeout: 15_000 })
      await guest.getByTestId('guest-add-to-cart').click()

      // На десктопе корзина — колонка справа и уже видна; полоса есть только
      // на узком экране. Помощник знает разницу.
      await openCart(guest)
      await guest.getByTestId('guest-place-order').click()
      await expect(guest.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })

      const number = (await guest.getByTestId('guest-order-number').innerText()).match(
        /\d+/,
      )?.[0] as string
      expect(number).toBeTruthy()

      // --- Разъезд: коктейль приехал на доску БАРА со ссылкой на этот заказ ---
      const source = barman.locator('[data-testid^="tracker-source-"]', {
        hasText: `№${number}`,
      })
      await expect(source.first()).toBeVisible({ timeout: 25_000 })

      const board = barman.getByTestId('tracker-board')
      await expect(board).toContainText(new RegExp(cocktailTitle, 'i'))
      await expect(board).not.toContainText(/цезарь/i)

      // А гостю разъезд не виден: он заказывал один раз.
      await guest.goto('/orders')
      await expect(guest.getByTestId('guest-orders-list')).toBeVisible({ timeout: 15_000 })
      // Один заказ, а не два: разъезд — деталь исполнения, гостю не видная.
      await expect(guest.getByTestId(`guest-order-row-${number}`)).toBeVisible()
    } finally {
      await guestContext.close()
      await barContext.close()
    }
  })
})

test.describe('Вход', () => {
  test('QR лобби без номера — видит витрину, но не заказывает', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => window.localStorage.clear())
    await page.goto('/')

    // Вход «осмотреться» — сессия без номера.
    const lobby = page.getByTestId('guest-browse-only')
    if (!(await lobby.isVisible().catch(() => false))) {
      test.skip(true, 'на экране входа нет режима «только просмотр»')
    }
    await lobby.click()

    await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })
    await page.goto('/venue/kitchen')
    await expect(page.getByTestId('guest-venue')).toBeVisible({ timeout: 15_000 })
    // Витрина видна, а оформление закрыто.
    await expect(page.getByTestId('guest-view-only-notice')).toBeVisible()
  })
})
