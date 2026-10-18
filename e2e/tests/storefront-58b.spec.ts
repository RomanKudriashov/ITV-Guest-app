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

test('окно позиции на ПК: фото слева колонкой 40–45 % окна, заполнено по фокусу (58б, откат)', async ({ page, request }) => {
  const token = await guestSession(request)
  const res = await request.get(`${API}/api/guest/catalog?type=product&point=kitchen`, {
    headers: { 'X-Hotel-Subdomain': HOTEL, Authorization: `Bearer ${token}` },
  })
  const items = ((await res.json()).categories as Array<{ items: Array<{ id: string; code: string }> }>).flatMap((c) => c.items)
  const duck = items.find((i) => i.code === 'duck-breast')!
  await enter(page, 1440)
  await page.goto(`/venue/kitchen?item=${duck.id}`)
  const sheet = page.getByTestId('guest-item-sheet')
  await expect(sheet).toBeVisible({ timeout: 15_000 })
  const frame = sheet.locator('[data-fit]').first()
  await expect(frame).toBeVisible()
  const [s, f] = await Promise.all([sheet.boundingBox(), frame.boundingBox()])
  // Колонка слева, а не кадр сверху: x совпадает, ширина — 40–45 % окна.
  expect(f!.x - s!.x).toBeLessThan(3)
  expect(f!.width / s!.width).toBeGreaterThanOrEqual(0.4)
  expect(f!.width / s!.width).toBeLessThanOrEqual(0.46)
  // «Заполнить»: даже вертикальное фото — cover, размытых полей нет.
  expect(await frame.getAttribute('data-fit')).toBe('cover')
  expect(await sheet.locator('[data-testid$="backdrop"]').count()).toBe(0)
})

for (const width of [1440, 390]) {
  test(`плитки главной не шире 3:1 (${width})`, async ({ page }) => {
    await enter(page, width)
    const tiles = page.locator('[data-testid^="guest-home-tile-"]')
    await expect(tiles.first()).toBeVisible()
    for (const tile of await tiles.all()) {
      expect(await ratioOf(tile), await tile.getAttribute('data-testid')).toBeLessThanOrEqual(3.05)
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
      }
    }
  })
}

for (const [width, max] of [[1440, 3.02], [390, null]] as const) {
  test(`баннер главной: на ПК не шире 3:1, на телефоне как был (${width})`, async ({ page, request }) => {
    // Баннера у демо-отеля нет — подставляем ответ ручки с настоящим фото позиции.
    const token = await guestSession(request)
    const res = await request.get(`${API}/api/guest/catalog?type=product&point=kitchen`, {
      headers: { 'X-Hotel-Subdomain': HOTEL, Authorization: `Bearer ${token}` },
    })
    const items = ((await res.json()).categories as Array<{ items: Array<{ photos?: Array<{ src: string }> }> }>).flatMap((c) => c.items)
    const photo = items.find((i) => i.photos?.length)!.photos![0]
    await page.route('**/api/**/guest/banner**', (route) =>
      route.fulfill({
        json: {
          banner: {
            id: 'e2e-banner', title: 'Баннер', subtitle: '', size: 'm', placement: 'top',
            images: [photo.src], image_refs: [photo], action: { kind: 'none' },
          },
        },
      }),
    )
    await enter(page, width)
    const banner = page.getByTestId('guest-banner').first()
    await expect(banner).toBeVisible({ timeout: 15_000 })
    const box = (await banner.boundingBox())!
    if (max) expect(box.width / box.height, 'баннер полосой шире 3:1').toBeLessThanOrEqual(max)
    else expect(Math.round(box.height)).toBe(150)
  })
}

test('шапки на ПК не шире 3:1', async ({ page }) => {
  await enter(page, 1440)
  const hero = page.getByTestId('guest-home-hero')
  expect(await ratioOf(hero)).toBeLessThanOrEqual(3.02)

  await page.goto('/venue/kitchen')
  const head = page.getByTestId('guest-venue-header')
  await expect(head).toBeVisible({ timeout: 15_000 })
  expect(await ratioOf(head)).toBeLessThanOrEqual(3.02)

  await page.goto('/info')
  const info = page.getByTestId('guest-catalog-hero')
  await expect(info).toBeVisible({ timeout: 15_000 })
  expect(await ratioOf(info)).toBeLessThanOrEqual(3.02)
})

test('фон бренда: тонировка цветом страницы на месте, слайдер «Затемнение» — поверх фото (58б, откат)', async ({ page, request }) => {
  const token = await guestSession(request)
  const hotel = await (await request.get(`${API}/api/guest/hotel`, { headers: { 'X-Hotel-Subdomain': HOTEL, Authorization: `Bearer ${token}` } })).json()
  const bg = hotel.theme?.brand?.background ?? {}
  test.skip(bg.kind !== 'image', 'у отеля не фото')
  await enter(page, 1440)
  // Тонировка — часть бренда: вуаль из контраста текста, как до 58б (0,85+).
  const veil = Number(await page.getByTestId('guest-backdrop-veil').getAttribute('data-veil'))
  expect(veil, 'тонировку фона сняли').toBeGreaterThanOrEqual(0.5)
  // Слайдер работает и на общем фоне — своим слоем, а не вместо тонировки.
  if ((bg.dim ?? 0) > 0) {
    expect(Number(await page.getByTestId('guest-backdrop-dim').getAttribute('data-dim'))).toBeCloseTo(bg.dim, 2)
  }
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
