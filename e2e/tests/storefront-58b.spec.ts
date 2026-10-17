import { type Locator, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, DEMO_ROOM, HOTEL, guestSession } from './helpers'

/**
 * РАСКЛАДКИ, ЗАТЕМНЕНИЯ, КОСЯКИ ВИТРИНЫ (партия 58б).
 *
 * Замер 58а: окно позиции резало кадр колонкой 400 px, широкая плитка и хвост
 * мозаики были полосами 1032×150/189, шапки — 3,6–4:1; поверх фото лежало по
 * два затемнения, а фон бренда закрывала вуаль 0,85–1,0. Снимки Олега: строка
 * категорий и нижнее меню прозрачны, КБЖУ с висящими точками, описание в
 * рамке, мелкий «+», °F у Москвы.
 */

async function enter(page: Page, width: number, view: 'cards' | 'mosaic' = 'cards') {
  await page.setViewportSize({ width, height: width === 390 || width === 360 ? 844 : 900 })
  await page.goto('/')
  await page.evaluate((v) => localStorage.setItem('itv.guest.menu-view', v), view)
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
}

const ratioOf = (el: Locator) =>
  el.evaluate((n) => {
    const r = n.getBoundingClientRect()
    return r.width / r.height
  })

/** Сколько слоёв затемнения лежит поверх кадра места (полноразмерных, с заливкой). */
const fullOverlays = (el: Locator) =>
  el.evaluate((root) => {
    const box = root.getBoundingClientRect()
    let n = 0
    for (const child of root.querySelectorAll('*')) {
      const c = child as HTMLElement
      // Кадр, слайдер «Затемнение» и фирменная заглушка без фото — не затемнения.
      if (c.tagName === 'IMG' || c.dataset.dim !== undefined || c.dataset.fallback !== undefined || /cover|backdrop/.test(c.dataset.testid ?? '')) continue
      if (c.closest('[data-fit]')) continue
      const r = c.getBoundingClientRect()
      if (r.width < box.width * 0.95 || r.height < box.height * 0.9) continue
      const cs = getComputedStyle(c)
      const filled = cs.backgroundImage !== 'none' || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)
      if (filled) n += 1
    }
    return n
  })

test('окно позиции на ПК: кадр сверху во всю ширину, форма 16:9…21:9', async ({ page, request }) => {
  const token = await guestSession(request)
  const res = await request.get(`${API}/api/guest/catalog?type=product&point=kitchen`, {
    headers: { 'X-Hotel-Subdomain': HOTEL, Authorization: `Bearer ${token}` },
  })
  const items = ((await res.json()).categories as Array<{ items: Array<{ id: string; code: string }> }>).flatMap((c) => c.items)
  const caesar = items.find((i) => i.code === 'caesar')!
  await enter(page, 1440)
  await page.goto(`/venue/kitchen?item=${caesar.id}`)
  const sheet = page.getByTestId('guest-item-sheet')
  await expect(sheet).toBeVisible({ timeout: 15_000 })
  const frame = sheet.locator('[data-fit]').first()
  await expect(frame).toBeVisible()
  const [s, f] = await Promise.all([sheet.boundingBox(), frame.boundingBox()])
  // Во всю ширину окна, сверху, а не колонкой слева.
  // Кант стекла окна — по пикселю с каждой стороны.
  expect(f!.width).toBeGreaterThanOrEqual(s!.width - 3)
  expect(f!.y - s!.y).toBeLessThan(3)
  const ratio = f!.width / f!.height
  expect(ratio).toBeGreaterThanOrEqual(16 / 9 - 0.02)
  expect(ratio).toBeLessThanOrEqual(21 / 9 + 0.02)
  expect(await frame.getAttribute('data-fit')).toBe('cover')
})

for (const width of [1440, 390]) {
  test(`плитки главной не шире 3:1 и без лишнего затемнения (${width})`, async ({ page }) => {
    await enter(page, width)
    const tiles = page.locator('[data-testid^="guest-home-tile-"]')
    await expect(tiles.first()).toBeVisible()
    for (const tile of await tiles.all()) {
      expect(await ratioOf(tile), await tile.getAttribute('data-testid')).toBeLessThanOrEqual(3.05)
      expect(await fullOverlays(tile), 'скрим на всю плитку').toBe(0)
    }
  })

  test(`хвост мозаики не полоса: ни одна плитка шире 3:1 (${width})`, async ({ page }) => {
    await enter(page, width, 'mosaic')
    for (const venue of ['kitchen', 'bar']) {
      await page.goto(`/venue/${venue}`)
      const tiles = page.locator('[data-testid^="guest-mosaic-tile-"]')
      await expect(tiles.first()).toBeVisible({ timeout: 15_000 })
      for (const tile of await tiles.all()) {
        await tile.scrollIntoViewIfNeeded()
        expect(await ratioOf(tile), `${venue} ${await tile.getAttribute('data-testid')}`).toBeLessThanOrEqual(3.05)
        // Одно затемнение: подложка текста, а не «глубина» на весь кадр.
        if (!(await tile.locator('[data-testid^="guest-mosaic-off-"]').count())) {
          expect(await fullOverlays(tile), 'второй слой на плитке мозаики').toBe(0)
        }
      }
    }
  })
}

test('шапки на ПК не шире 3:1, на кадре одно затемнение', async ({ page }) => {
  await enter(page, 1440)
  const hero = page.getByTestId('guest-home-hero')
  expect(await ratioOf(hero)).toBeLessThanOrEqual(3.02)
  expect(await fullOverlays(hero), 'скрим обложки').toBe(0)

  await page.goto('/venue/kitchen')
  const head = page.getByTestId('guest-venue-header')
  await expect(head).toBeVisible({ timeout: 15_000 })
  expect(await ratioOf(head)).toBeLessThanOrEqual(3.02)
  expect(await fullOverlays(head), 'скрим шапки заведения поверх подложки').toBe(0)

  await page.goto('/info')
  const info = page.getByTestId('guest-catalog-hero')
  await expect(info).toBeVisible({ timeout: 15_000 })
  expect(await ratioOf(info)).toBeLessThanOrEqual(3.02)
  expect(await fullOverlays(info), 'градиенты шапки раздела').toBe(0)
})

test('фон бренда: над фото только слайдер «Затемнение», не вуаль 0,85+', async ({ page, request }) => {
  const token = await guestSession(request)
  const hotel = await (await request.get(`${API}/api/guest/hotel`, { headers: { 'X-Hotel-Subdomain': HOTEL, Authorization: `Bearer ${token}` } })).json()
  const bg = hotel.theme?.brand?.background ?? {}
  test.skip(bg.kind !== 'image', 'у отеля не фото — вуаль прежняя')
  await enter(page, 1440)
  const veil = Number(await page.getByTestId('guest-backdrop-veil').getAttribute('data-veil'))
  expect(veil).toBeCloseTo(bg.dim ?? 0, 2)
  expect(veil).toBeLessThan(0.5)
})

for (const width of [390, 360]) {
  test(`телефон ${width}: строка категорий не под плавающей группой, первая вкладка не срезана`, async ({ page }) => {
    await enter(page, width)
    await page.goto('/venue/kitchen')
    const bar = page.getByTestId('guest-category-bar')
    await expect(bar).toBeVisible({ timeout: 15_000 })
    for (const y of [300, 900, 1600]) {
      await page.evaluate((top) => scrollTo(0, top), y)
      await page.waitForTimeout(400)
      const [b, g] = await Promise.all([bar.boundingBox(), page.getByTestId('guest-floating-group').boundingBox()])
      expect(b!.y, `строка под группой на прокрутке ${y}`).toBeGreaterThanOrEqual(g!.y + g!.height - 1)
    }
    const first = page.locator('[data-testid^="guest-category-tab-"]').first()
    const [fb, bb] = await Promise.all([first.boundingBox(), bar.boundingBox()])
    expect(fb!.x - bb!.x, 'первая вкладка упёрлась в скруглённый край').toBeGreaterThanOrEqual(6)
    // Стекло почти сплошное: сквозь него не читаются цены карточек.
    const alpha = await bar.evaluate((n) => Number((getComputedStyle(n).backgroundColor.match(/[\d.]+\)$/) ?? ['1'])[0].replace(')', '')))
    expect(alpha).toBeGreaterThanOrEqual(0.85)
  })
}

test('нижнее меню: сплошное стекло, конец списка не уходит под меню', async ({ page }) => {
  await enter(page, 390)
  await page.goto('/venue/kitchen')
  const nav = page.getByTestId('guest-bottom-nav')
  await expect(nav).toBeVisible({ timeout: 15_000 })
  const alpha = await nav.evaluate((n) => Number((getComputedStyle(n).backgroundColor.match(/[\d.]+\)$/) ?? ['1'])[0].replace(')', '')))
  expect(alpha).toBeGreaterThanOrEqual(0.85)
  for (let i = 0; i < 15; i += 1) {
    await page.mouse.wheel(0, 1500)
    await page.waitForTimeout(80)
  }
  await page.waitForTimeout(600)
  // Кнопка добавления последней карточки — самое нижнее, во что гость тычет.
  const last = page.locator('[data-testid^="guest-qty-plus-"]').last()
  const [lb, nb] = await Promise.all([last.boundingBox(), nav.boundingBox()])
  expect(lb!.y + lb!.height, 'конец списка под меню').toBeLessThanOrEqual(nb!.y + 1)
})

test('карточка меню: КБЖУ без висящих точек, описание без рамки, «+» крупный', async ({ page }) => {
  await enter(page, 390)
  await page.goto('/venue/kitchen')
  const card = page.getByTestId('guest-item-caesar')
  await expect(card).toBeVisible({ timeout: 15_000 })
  const nutrition = card.getByTestId('guest-item-nutrition-inline')
  // Каждый кусок неразрывный, и ни один не состоит из одной точки.
  const pieces = await nutrition.locator(':scope > span').allTextContents()
  expect(pieces.length).toBeGreaterThan(1)
  for (const p of pieces) expect(p.trim()).not.toMatch(/^·|·$/)
  const boxed = await card.evaluate((n) => {
    for (const el of n.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      if ((el as HTMLElement).innerText?.length > 10 && cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none' && el.querySelector('*') === null) return true
      if (el.children.length === 1 && (el.firstElementChild as HTMLElement)?.innerText?.length > 10 && cs.backdropFilter && cs.backdropFilter !== 'none') return true
    }
    return false
  })
  expect(boxed, 'описание в стеклянной рамке, как поле ввода').toBe(false)
  const plus = card.getByTestId('guest-add-icon')
  if (await plus.count()) {
    const box = await plus.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(20)
  }
})

test('погода у отеля в России — °C', async ({ page }) => {
  await enter(page, 1440)
  const weather = page.getByTestId('guest-home-weather-now')
  // Погода приходит отдельным запросом — ждём её, а не первый кадр главной.
  await weather.waitFor({ timeout: 15_000 }).catch(() => {})
  test.skip(!(await weather.count()), 'погода выключена')
  await expect(weather).toContainText('°C')
  await expect(weather).not.toContainText('°F')
})
