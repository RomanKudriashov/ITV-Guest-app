import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, DEMO_ROOM, HOTEL, guestSession, openCart } from './helpers'

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
