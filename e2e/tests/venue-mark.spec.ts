import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, DEMO_ROOM, apiHeaders, apiToken, guestTheme } from './helpers'
import { STORAGE_KEYS } from '../fixtures/appState'

/**
 * ЗНАЧОК ЗАВЕДЕНИЯ У ГОСТЯ (партия 38, п.68): квадрат из обложки → иконка по
 * типу → цвет бренда.
 *
 * Мерится вид, а не наличие: квадрат 56×56 с `object-fit: cover` из лёгкого
 * варианта обложки; без обложки — иконка ТИПА (у СПА — ванна, а не вилка-нож,
 * как было везде) на основном цвете бренда.
 */

async function enterLight(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(([key]) => {
    localStorage.clear()
    localStorage.setItem(key, 'light')
  }, [STORAGE_KEYS.theme])
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
}

async function search(page: Page, text: string): Promise<void> {
  await page.goto('/search')
  await page.getByTestId('guest-search-input').fill(text)
}

function rgb(hex: string): string {
  const value = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

test('заведение с обложкой — квадрат из неё, лёгкий вариант', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enterLight(page)
  await search(page, 'Кухня')
  const mark = page.getByTestId('guest-search-mark-kitchen')
  await expect(mark.locator('img')).toBeVisible({ timeout: 20_000 })
  const look = await mark.evaluate((node) => {
    const img = node.querySelector('img') as HTMLImageElement
    const box = node.getBoundingClientRect()
    return { w: Math.round(box.width), h: Math.round(box.height), fit: getComputedStyle(img).objectFit, src: img.currentSrc }
  })
  expect(look.w).toBe(56)
  expect(look.h).toBe(56)
  expect(look.fit, 'квадрат вырезается из обложки, а не сжимается').toBe('cover')
  expect(look.src, 'строке 56×56 — вариант thumb, а не card').toContain('/thumb/')
})

test('заведение без обложки — иконка по типу на цвете бренда', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const headers = apiHeaders(await apiToken(request, ADMIN))
  const suffix = `m${Date.now().toString(36).slice(-7)}`
  const name = `Термы ${suffix}`
  const created = await request.post(`${API}/api/cms/services`, {
    headers,
    data: { type: 'spa', public_name: { ru: name, en: name }, is_guest_facing: true, code: `e2e-spa-${suffix}` },
  })
  expect(created.status(), await created.text()).toBe(201)
  const service = await created.json()
  try {
    const primary = rgb(((await guestTheme(request)).palette?.light?.primary ?? '') as string)
    await enterLight(page)
    await search(page, name)
    const mark = page.getByTestId(`guest-search-mark-${service.code}`)
    await expect(mark.locator('[data-mark="icon"]')).toBeVisible({ timeout: 20_000 })
    const look = await mark.evaluate((node) => {
      const icon = node.querySelector('[data-mark="icon"]') as HTMLElement
      return {
        icon: icon.querySelector('[data-icon]')?.getAttribute('data-icon'),
        background: getComputedStyle(icon).backgroundColor,
        img: node.querySelectorAll('img').length,
      }
    })
    expect(look.icon, 'у СПА — ванна, а не вилка-нож').toBe('bath')
    expect(look.background, 'фон — основной цвет бренда').toBe(primary)
    expect(look.img).toBe(0)
  } finally {
    await request.delete(`${API}/api/cms/services/${service.id}`, { headers })
  }
})
