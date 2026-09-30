import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken } from './helpers'
import { brandSession } from './brandGuest'
import { pngRGBA } from './pngFixture'

/**
 * ЛОГОТИП ИЗ БРЕНДБУКА ДОХОДИТ ДО ГОСТЯ КАК ЕСТЬ (партия 25).
 *
 * - Прозрачный PNG: нарезка переводила всё в RGB, и прозрачное поле
 *   логотипа становилось белым квадратом на тёмном экране входа. Замер —
 *   пикселем: угол знака совпадает с фоном рядом с ним, центр — цвет знака.
 * - SVG: не принимался вовсе. Теперь грузится через редактор и рисуется у
 *   гостя.
 * - Экран входа тёмный в обеих темах: на нём знак под тёмный фон
 *   (`logoDark`), даже когда гость в светлой теме.
 *
 * Бренд возвращается к исходному.
 */

const RED: [number, number, number, number] = [200, 20, 40, 255]
const CLEAR_WHITE: [number, number, number, number] = [255, 255, 255, 0]

/** Круглый знак на прозрачном поле; прозрачное — белое, чтобы потеря альфы была видна. */
const LOGO = pngRGBA(240, 240, (x, y) => ((x - 120) ** 2 + (y - 120) ** 2 < 90 ** 2 ? RED : CLEAR_WHITE))

async function uploadBrandMedia(
  request: APIRequestContext,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<string> {
  const headers = apiHeaders(await apiToken(request, ADMIN))
  const response = await request.post(`${API}/api/v1/cms/media`, {
    headers,
    multipart: { file, kind: 'brand' },
  })
  expect(response.status(), await response.text()).toBe(201)
  const { id } = await response.json()
  let url = ''
  await expect
    .poll(
      async () => {
        const asset = await (await request.get(`${API}/api/v1/cms/media/${id}`, { headers })).json()
        url = asset.url
        return asset.status
      },
      { timeout: 30_000, message: 'логотип не нарезался' },
    )
    .toBe('ready')
  return url
}

async function entry(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((mode) => localStorage.setItem('itv.theme-mode', mode), theme)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const logo = page.getByTestId('guest-brand-logo')
  await expect(logo).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeTruthy()
}

/** Пиксели снимка области вокруг логотипа: снаружи (фон), угол знака, центр знака. */
async function logoPixels(page: Page) {
  const box = (await page.getByTestId('guest-brand-logo').boundingBox())!
  const pad = 4
  const shot = await page.screenshot({
    clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 },
  })
  return page.evaluate(
    async ({ src, pad, w, h }) => {
      const image = new Image()
      image.src = src
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      const scale = image.naturalWidth / (w + pad * 2)
      const at = (x: number, y: number) => [...ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data]
      // Знак вписан по высоте: его квадрат — по центру рамки.
      const side = Math.min(w, h)
      const left = pad + (w - side) / 2
      return {
        outside: at(1, 1),
        corner: at(left + 1, pad + 1),
        centre: at(left + side / 2, pad + h / 2),
      }
    },
    { src: `data:image/png;base64,${shot.toString('base64')}`, pad, w: box.width, h: box.height },
  )
}

const distance = (a: number[], b: number[]) => Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i])))

test('прозрачный PNG-логотип прозрачен у гостя — замер пикселем', async ({ page, request }) => {
  test.setTimeout(120_000)
  const brand = await brandSession(request)
  try {
    const url = await uploadBrandMedia(request, { name: 'logo.png', mimeType: 'image/png', buffer: LOGO })
    await brand.apply({ brand: { logoLight: url, logoDark: url } })
    await entry(page, 'dark')
    const px = await logoPixels(page)
    expect(distance(px.corner, px.outside), `угол логотипа не прозрачен: ${px.corner} против фона ${px.outside}`).toBeLessThan(24)
    expect(distance(px.centre, RED), `знак не нарисован: ${px.centre}`).toBeLessThan(40)
  } finally {
    await brand.restore()
  }
})

test('SVG-логотип грузится через редактор и рисуется у гостя', async ({ page, request }) => {
  test.setTimeout(120_000)
  const brand = await brandSession(request)
  try {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" rx="4" fill="#c81428"/></svg>',
    )
    const url = await uploadBrandMedia(request, { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: svg })
    expect(url, 'у SVG нет адреса').toMatch(/\.svg$/)
    await brand.apply({ brand: { logoLight: url, logoDark: url } })
    await entry(page, 'light')
    const logo = page.getByTestId('guest-brand-logo')
    await expect(logo).toHaveAttribute('src', url)
    expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth), 'SVG не отрисовался').toBeGreaterThan(0)
  } finally {
    await brand.restore()
  }
})

test('экран входа тёмный — на нём знак под тёмный фон и в светлой теме', async ({ page, request }) => {
  test.setTimeout(120_000)
  const brand = await brandSession(request)
  try {
    const light = await uploadBrandMedia(request, { name: 'light.png', mimeType: 'image/png', buffer: LOGO })
    const dark = await uploadBrandMedia(request, {
      name: 'dark.png',
      mimeType: 'image/png',
      buffer: pngRGBA(60, 60, () => [240, 240, 240, 255]),
    })
    await brand.apply({ brand: { logoLight: light, logoDark: dark } })
    await entry(page, 'light')
    await expect(page.getByTestId('guest-brand-logo')).toHaveAttribute('src', dark)
  } finally {
    await brand.restore()
  }
})
