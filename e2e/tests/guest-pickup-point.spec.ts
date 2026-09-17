import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import {
  ADMIN,
  API,
  DEMO_ROOM,
  HOTEL,
  apiHeaders,
  apiToken,
  guestSession,
  openCart,
} from './helpers'

/**
 * МЕСТО ПОЛУЧЕНИЯ — ПО МАТРИЦЕ «КАТЕГОРИЯ × ЛОКАЦИЯ».
 *
 * Гостю показывались все локации отеля. Теперь места отбираются по позициям
 * корзины: у стойки лобби-бара (точка выдачи) выдают коктейли бара, но не
 * блюда кухни — и в корзине кухни стойки быть не должно, иначе повар понесёт
 * заказ туда, откуда за ним никто не придёт.
 */

async function enterAsGuest(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home-bento')).toBeVisible({ timeout: 15_000 })
}

test('в корзине кухни стойки бара нет, а для коктейлей она есть', async ({ page, request }) => {
  await enterAsGuest(page)
  await page.getByTestId('guest-home-tile-kitchen').click()
  await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('guest-item-ribeye').click()
  await page.getByTestId('guest-add-to-cart').click()
  await openCart(page)

  await expect(page.getByTestId('guest-location-in_room')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('guest-location-bar-counter')).toHaveCount(0)

  // Коктейли — сервером: бар может быть закрыт по расписанию в момент прогона,
  // а правило мест от часов работы не зависит.
  const guest = await guestSession(request)
  const headers = { Authorization: `Bearer ${guest}`, 'X-Hotel-Subdomain': HOTEL }
  const catalog = await (
    await request.get(`${API}/api/guest/catalog?type=product&point=bar`, { headers })
  ).json()
  const negroni = catalog.categories
    .flatMap((category: { items: { id: string; code: string }[] }) => category.items)
    .find((item: { code: string }) => item.code === 'negroni')
  expect(negroni, 'в карте бара нет «Негрони»').toBeTruthy()
  const places = await (
    await request.get(`${API}/api/guest/locations?items=${negroni.id}`, { headers })
  ).json()
  const counter = places.locations.find((entry: { code: string }) => entry.code === 'bar-counter')
  expect(counter, 'у стойки лобби-бара коктейли выдают').toBeTruthy()
  expect(counter.delivery_mode).toBe('pickup')
})


/**
 * КОРЗИНА ИЗ ДВУХ ЗАВЕДЕНИЙ: место спрашивается один раз, пока оно у всех
 * частей общее, и по каждой части — когда гость захотел разные.
 */
test('корзина из двух заведений: одно место или по месту на часть', async ({ page, request }) => {
  test.slow()
  const h = apiHeaders(await apiToken(request, ADMIN))
  const tag = Date.now().toString(36)

  const services = (await request
    .get(`${API}/api/cms/services`, { headers: h })
    .then((r) => r.json())
    .then((body) => body.items)) as Array<{ id: string; code: string }>
  const kitchen = services.find((s) => s.code === 'kitchen')!
  const bar = services.find((s) => s.code === 'bar')!
  const barPoint = (
    await request.get(`${API}/api/cms/services/${bar.id}`, { headers: h }).then((r) => r.json())
  ).execution_point.id

  const category = await request
    .post(`${API}/api/cms/categories`, {
      data: { type: 'product', title: { ru: `Коктейли ${tag}` }, service_id: bar.id },
      headers: h,
    })
    .then((r) => r.json())
  await request.put(`${API}/api/cms/categories/${category.id}/routes`, {
    data: { routes: [{ execution_point_id: barPoint }] },
    headers: h,
  })
  const cocktailTitle = `Шприц ${tag}`
  await request.post(`${API}/api/cms/items`, {
    data: { category_id: category.id, type: 'product', title: { ru: cocktailTitle }, price: 50000 },
    headers: h,
  })

  // Коктейли — в номер и у стойки бара: матрица явная.
  const matrix = await request
    .get(`${API}/api/cms/locations/matrix`, { headers: h })
    .then((r) => r.json())
  const placeId = (code: string) =>
    matrix.locations.find((entry: { code: string }) => entry.code === code).id
  const linked = await request.put(`${API}/api/cms/locations/matrix`, {
    data: {
      category_id: category.id,
      cells: [
        { location_id: placeId('in_room'), enabled: true },
        { location_id: placeId('bar-counter'), enabled: true },
      ],
    },
    headers: h,
  })
  expect(linked.ok(), await linked.text()).toBeTruthy()

  const aggregator = await request
    .post(`${API}/api/cms/services`, {
      data: { type: 'room_service', public_name: { ru: `Рум-сервис ${tag}` } },
      headers: h,
    })
    .then((r) => r.json())
  for (const source of [kitchen.id, bar.id]) {
    const included = await request.post(`${API}/api/cms/services/${aggregator.id}/inclusions`, {
      data: { source_service_id: source },
      headers: h,
    })
    expect(included.ok(), await included.text()).toBeTruthy()
  }

  try {
    await enterAsGuest(page)
    await page.goto(`/venue/${aggregator.execution_point.code}`)
    await expect(page.getByTestId('guest-venue')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('guest-qty-plus-caesar').click()
    await page.getByText(cocktailTitle).first().click()
    await page.getByTestId('guest-add-to-cart').click()
    await openCart(page)

    // Общее место есть — спрашиваем один раз, стойки в общем списке нет:
    // салат у стойки бара не выдают.
    await expect(page.getByTestId('guest-location-in_room')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('guest-location-bar-counter')).toHaveCount(0)
    await expect(page.getByTestId('guest-places-by-part')).toHaveCount(0)

    // Гость хочет коктейль забрать у стойки — места по частям.
    await page.getByTestId('guest-places-split').click()
    await expect(page.getByTestId('guest-places-by-part')).toBeVisible()
    await expect(page.getByTestId('guest-part-kitchen-location-bar-counter')).toHaveCount(0)
    await page.getByTestId('guest-part-bar-location-bar-counter').click()
    await expect(page.getByTestId('guest-part-bar-location-pickup-hint')).toBeVisible()

    await page.getByTestId('guest-place-order').click()
    await expect(page.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
    const number = (await page.getByTestId('guest-order-number').innerText()).match(/\d+/)?.[0]
    expect(number).toBeTruthy()

    // Сервер записал места по частям: у бара — выдача, у кухни — доставка.
    // Ключ — тот же, что у витрины (`GUEST_TOKEN_KEY`).
    const guestToken = await page.evaluate(() => window.localStorage.getItem('itv.guest.token'))
    expect(guestToken, 'токен гостя не найден в хранилище').toBeTruthy()
    const orders = await request
      .get(`${API}/api/guest/orders`, {
        headers: { Authorization: `Bearer ${guestToken}`, 'X-Hotel-Subdomain': HOTEL },
      })
      .then((r) => r.json())
    const placed = [...orders.active, ...orders.past].find(
      (entry: { number: number }) => String(entry.number) === number,
    )
    expect(placed, `заказ №${number} не найден у гостя`).toBeTruthy()
    const parts = Object.fromEntries(
      placed.parts.map((part: { point: string; delivery_mode: string; location: { code: string } }) => [
        part.point,
        `${part.location.code}:${part.delivery_mode}`,
      ]),
    )
    expect(parts).toEqual({ kitchen: 'in_room:delivery', bar: 'bar-counter:pickup' })
  } finally {
    await request.delete(`${API}/api/cms/services/${aggregator.id}`, { headers: h })
  }
})
