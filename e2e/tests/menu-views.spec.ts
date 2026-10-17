import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, DEMO_ROOM, apiHeaders, apiToken } from './helpers'

/**
 * ДВА ВИДА МЕНЮ У ГОСТЯ (партия 57): «карточки» и «мозаика».
 *
 * Матрица: оба вида × 1440/390 × ru/ar × светлая/тёмная. Геометрию мозаики
 * меряем по плиткам, а не по атрибутам: «4 колонки» — это сколько колонок
 * ширины помещается в сетку, «большая 2×2» — её ширина и высота против мелкой.
 *
 * Состояние стенда, которое тест меняет (вид заведения, стоп-лист), ставится
 * явно и возвращается в finally; корзина после проверки чистится.
 */

const MENU_VIEW_KEY = 'itv.guest.menu-view'
const THEME_KEY = 'itv.theme-mode'
const LANG_KEY = 'itv.lang'

type Lang = 'ru' | 'ar'
type Theme = 'light' | 'dark'

async function enter(page: Page, { width = 1440, theme = 'light', lang = 'ru' }: { width?: number; theme?: Theme; lang?: Lang } = {}) {
  await page.setViewportSize({ width, height: 900 })
  await page.addInitScript(
    ([themeKey, theme, langKey, lang]) => {
      try {
        localStorage.setItem(themeKey, theme)
        localStorage.setItem(langKey, lang)
      } catch {
        /* приватный режим */
      }
    },
    [THEME_KEY, theme, LANG_KEY, lang] as const,
  )
  await page.goto('/')
  // Чистый гость: ни выбора вида, ни корзины от прошлых прогонов.
  await page.evaluate((key) => {
    for (const k of Object.keys(localStorage)) if (k === key || k.startsWith('itv.guest.cart.')) localStorage.removeItem(k)
  }, MENU_VIEW_KEY)
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(lang)
}

async function openVenue(page: Page, code: string) {
  await page.goto(`/venue/${code}`)
  await expect(page.getByTestId('guest-venue')).toBeVisible({ timeout: 15_000 })
}

async function serviceId(request: APIRequestContext, code: string): Promise<string> {
  const rows = await request.get(`${API}/api/cms/services?limit=500`, {
    headers: apiHeaders(await apiToken(request, ADMIN)),
  })
  expect(rows.ok()).toBeTruthy()
  const id = ((await rows.json()).items as Array<{ id: string; code: string }>).find((r) => r.code === code)?.id
  expect(id, `нет заведения ${code}`).toBeTruthy()
  return id!
}

async function setVenueView(request: APIRequestContext, id: string, view: 'cards' | 'mosaic') {
  const res = await request.patch(`${API}/api/cms/services/${id}`, {
    data: { menu_view: view },
    headers: apiHeaders(await apiToken(request, ADMIN)),
  })
  expect(res.ok(), await res.text()).toBeTruthy()
}

async function itemId(request: APIRequestContext, code: string): Promise<string> {
  const res = await request.get(`${API}/api/cms/items?limit=500`, {
    headers: apiHeaders(await apiToken(request, ADMIN)),
  })
  expect(res.ok()).toBeTruthy()
  const id = ((await res.json()).items as Array<{ id: string; code: string }>).find((r) => r.code === code)?.id
  expect(id, `нет позиции ${code}`).toBeTruthy()
  return id!
}

async function setStock(request: APIRequestContext, id: string, inStock: boolean) {
  const res = await request.post(`${API}/api/cms/items/${id}/stock`, {
    data: { in_stock: inStock },
    headers: apiHeaders(await apiToken(request, ADMIN)),
  })
  expect(res.ok(), await res.text()).toBeTruthy()
}

/** Геометрия первой сетки мозаики: колонки по ширине и прямоугольники плиток. */
async function mosaicGeometry(page: Page) {
  const grid = page.getByTestId('guest-mosaic-grid').first()
  await expect(grid).toBeVisible()
  return grid.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const gap = parseFloat(getComputedStyle(node).columnGap) || 0
    const tiles = [...node.querySelectorAll<HTMLElement>('[data-testid^="guest-mosaic-tile-"]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { size: el.dataset.size, left: r.left, right: r.right, width: r.width, height: r.height }
    })
    const col = Math.min(...tiles.map((t) => t.width))
    const row = Math.min(...tiles.map((t) => t.height))
    return { left: box.left, right: box.right, gap, col, row, cols: Math.round((box.width + gap) / (col + gap)), tiles }
  })
}

test.describe('Вид меню: матрица', () => {
  for (const width of [1440, 390])
    for (const lang of ['ru', 'ar'] as const)
      for (const theme of ['light', 'dark'] as const) {
        test(`оба вида — ${width} · ${lang} · ${theme}`, async ({ page }) => {
          await enter(page, { width, theme, lang })
          await openVenue(page, 'kitchen')

          // По умолчанию — карточки.
          const toggle = page.getByTestId('guest-menu-view-toggle')
          await expect(toggle).toBeVisible()
          await expect(page.getByTestId('guest-menu')).toHaveAttribute('data-menu-view', 'cards')
          await expect(page.getByTestId('guest-menu-view-cards')).toHaveAttribute('aria-pressed', 'true')
          await expect(page.getByTestId('guest-item-carbonara')).toBeVisible()
          await expect(page.getByTestId('guest-mosaic-grid')).toHaveCount(0)

          // Мозаика.
          await page.getByTestId('guest-menu-view-mosaic').click()
          await expect(page.getByTestId('guest-menu-view-mosaic')).toHaveAttribute('aria-pressed', 'true')
          await expect(page.getByTestId('guest-menu')).toHaveAttribute('data-menu-view', 'mosaic')
          await expect(page.getByTestId('guest-item-carbonara')).toHaveCount(0)

          const g = await mosaicGeometry(page)
          expect(g.cols).toBe(width >= 1024 ? 4 : 2)
          const big = g.tiles.find((t) => t.size === 'l')!
          expect(big, 'в первой категории есть большая плитка').toBeTruthy()
          expect(Math.abs(big.width - (2 * g.col + g.gap))).toBeLessThan(3)
          expect(Math.abs(big.height - (2 * g.row + g.gap))).toBeLessThan(3)
          // Клетка ≈ 4:3 — высота от ширины, до загрузки фото.
          expect(Math.abs(g.row / g.col - 0.75)).toBeLessThan(0.03)

          if (width >= 1024) {
            // Первая большая — у начала строки: слева в ru, справа в ar.
            if (lang === 'ar') expect(Math.abs(big.right - g.right)).toBeLessThan(2)
            else expect(Math.abs(big.left - g.left)).toBeLessThan(2)
          }

          // Текст на фото — белый в обеих темах.
          const color = await page
            .getByTestId('guest-mosaic-price-carbonara')
            .evaluate((el) => getComputedStyle(el).color)
          expect(color).toBe('rgb(255, 255, 255)')

          // Обратно в карточки.
          await page.getByTestId('guest-menu-view-cards').click()
          await expect(page.getByTestId('guest-menu')).toHaveAttribute('data-menu-view', 'cards')
        })
      }
})

test.describe('Вид меню: поведение', () => {
  test('переключатель только у товарных заведений', async ({ page }) => {
    await enter(page)
    await openVenue(page, 'kitchen')
    await expect(page.getByTestId('guest-menu-view-toggle')).toBeVisible()
    for (const code of ['spa', 'concierge']) {
      await openVenue(page, code)
      await expect(page.getByTestId('guest-venue-name')).toBeVisible()
      await expect(page.getByTestId('guest-menu-view-toggle')).toHaveCount(0)
    }
    await page.goto('/info')
    await expect(page.getByTestId('guest-info-catalog')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('guest-menu-view-toggle')).toHaveCount(0)
  })

  test('выбор запоминается после перезагрузки и действует на другом заведении', async ({ page }) => {
    await enter(page)
    await openVenue(page, 'kitchen')
    await page.getByTestId('guest-menu-view-mosaic').click()
    await expect(page.getByTestId('guest-mosaic-grid').first()).toBeVisible()
    expect(await page.evaluate((k) => localStorage.getItem(k), MENU_VIEW_KEY)).toBe('mosaic')

    await page.reload()
    await expect(page.getByTestId('guest-menu')).toHaveAttribute('data-menu-view', 'mosaic', { timeout: 15_000 })

    await openVenue(page, 'bar')
    await expect(page.getByTestId('guest-menu')).toHaveAttribute('data-menu-view', 'mosaic', { timeout: 15_000 })
    await expect(page.getByTestId('guest-menu-view-mosaic')).toHaveAttribute('aria-pressed', 'true')
  })

  test('вид заведения действует, пока гость не выбрал сам', async ({ page, request }) => {
    const kitchen = await serviceId(request, 'kitchen')
    await setVenueView(request, kitchen, 'mosaic')
    try {
      await enter(page)
      await openVenue(page, 'kitchen')
      await expect(page.getByTestId('guest-menu')).toHaveAttribute('data-menu-view', 'mosaic', { timeout: 15_000 })
      // Другое заведение — со своим видом (карточки).
      await openVenue(page, 'bar')
      await expect(page.getByTestId('guest-menu')).toHaveAttribute('data-menu-view', 'cards', { timeout: 15_000 })

      // Гость выбрал карточки — его выбор сильнее заведения.
      await openVenue(page, 'kitchen')
      await page.getByTestId('guest-menu-view-cards').click()
      await page.reload()
      await expect(page.getByTestId('guest-menu')).toHaveAttribute('data-menu-view', 'cards', { timeout: 15_000 })
    } finally {
      await setVenueView(request, kitchen, 'cards')
    }
  })

  test('«+»: простая — в корзину и счётчик, с опциями — карточка позиции', async ({ page }) => {
    await enter(page)
    await openVenue(page, 'kitchen')
    await page.getByTestId('guest-menu-view-mosaic').click()

    const tile = page.getByTestId('guest-mosaic-tile-carbonara')
    await tile.getByTestId('guest-qty-plus-carbonara').click()
    const counter = page.getByTestId('guest-mosaic-counter-carbonara')
    await expect(counter).toBeVisible()
    await expect(counter).toContainText('1')
    // Карточка позиции при этом не открылась.
    await expect(page.getByTestId('guest-item-sheet')).toHaveCount(0)
    // Корзину — обратно пустой.
    await counter.getByTestId('guest-qty-minus-carbonara').click()
    await expect(counter).toHaveCount(0)
    await expect(tile.getByTestId('guest-qty-plus-carbonara')).toBeVisible()

    const ribeye = page.getByTestId('guest-mosaic-tile-ribeye').getByTestId('guest-qty-plus-ribeye')
    await expect(ribeye).toHaveAttribute('aria-haspopup', 'dialog')
    await ribeye.click()
    await expect(page.getByTestId('guest-item-sheet').first()).toBeVisible()

    // Клавиатура: плитка открывается Enter.
    await page.getByTestId('guest-item-sheet-close').click()
    await expect(page.getByTestId('guest-item-sheet')).toHaveCount(0)
    await tile.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('guest-item-sheet').first()).toBeVisible()
  })

  test('стоп-лист: затемнение и без «+»', async ({ page, request }) => {
    const caesar = await itemId(request, 'caesar')
    await setStock(request, caesar, false)
    try {
      await enter(page)
      await openVenue(page, 'kitchen')
      await page.getByTestId('guest-menu-view-mosaic').click()
      const tile = page.getByTestId('guest-mosaic-tile-caesar')
      await expect(tile).toBeVisible()
      await expect(page.getByTestId('guest-mosaic-off-caesar')).toBeVisible()
      await expect(tile.getByTestId('guest-qty-plus-caesar')).toHaveCount(0)
    } finally {
      await setStock(request, caesar, true)
    }
  })
})
