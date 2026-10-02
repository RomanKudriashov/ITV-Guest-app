import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, HOTEL, apiHeaders, apiToken } from './helpers'
import { guestPage, uploadMedia } from './brandGuest'
import { pngRGBA } from './pngFixture'

/**
 * НАЗВАНИЕ ЗАВЕДЕНИЯ НА КАДРЕ ЧИТАЕТСЯ НА ЛЮБОМ ФОТО (партия 29).
 *
 * Градиент шапки был один на все кадры: на тёмной «Террасе» хватало, на
 * светлом зале «Сиалии» 13 шапок из 25 давали ниже 3:1. Теперь под названием
 * подложка, плотность которой подобрана из контраста к любому пикселю кадра.
 *
 * Мерится то, что видит глаз: снимок шапки с ПРЯТАННЫМ названием, яркость
 * пикселей под его рамкой, контраст цвета названия к самым светлым 5 % из них
 * (одиночные блики не в счёт, светлое небо — в счёт). Порог — 4,5:1.
 *
 * Условие задаётся явно: одному заведению ставится БЕЛЫЙ кадр — худший случай
 * для белого названия — и возвращается прежний.
 */

const WHITE = pngRGBA(320, 200, () => [255, 255, 255, 255])
const TARGET = 4.5

async function titleContrast(page: Page): Promise<number> {
  const title = page.getByTestId('guest-venue-name')
  await expect(title).toBeVisible({ timeout: 20_000 })
  const color = await title.evaluate((el) => getComputedStyle(el).color)
  await title.evaluate((el) => {
    el.style.color = 'transparent'
    el.style.textShadow = 'none'
  })
  const shot = await page.screenshot({ clip: (await title.boundingBox())! })
  await title.evaluate((el) => {
    el.style.color = ''
    el.style.textShadow = ''
  })
  return page.evaluate(
    async ({ src, color }) => {
      const image = new Image()
      image.src = src
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const channel = (v: number) => {
        const x = v / 255
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
      }
      const lum = (r: number, g: number, b: number) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
      const values: number[] = []
      for (let i = 0; i < data.length; i += 4) values.push(lum(data[i], data[i + 1], data[i + 2]))
      values.sort((a, b) => a - b)
      const [r, g, b] = (color.match(/\d+(\.\d+)?/g) ?? ['255', '255', '255']).map(Number)
      const text = lum(r, g, b)
      // Светлое название — худший фон самый светлый; тёмное — самый тёмный.
      const bg = text > 0.5 ? values[Math.floor(values.length * 0.95)] : values[Math.floor(values.length * 0.05)]
      return (Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05)
    },
    { src: `data:image/png;base64,${shot.toString('base64')}`, color },
  )
}

/** Коды заведений на витрине гостя: плитки главной и списки свёрнутых групп. */
async function venueCodes(request: APIRequestContext): Promise<string[]> {
  const headers = apiHeaders(await apiToken(request, ADMIN))
  const services = (await (await request.get(`${API}/api/cms/services?limit=200`, { headers })).json()).items as Array<{
    code: string
    is_active: boolean
    is_guest_facing?: boolean
  }>
  return services.filter((s) => s.is_active && s.is_guest_facing !== false).map((s) => s.code)
}

test.describe('Название заведения на кадре', () => {
  test.describe.configure({ mode: 'serial' })

  test('белый кадр: название держит 4,5:1 — телефон и ПК, обе темы', async ({ browser, request }) => {
    test.setTimeout(180_000)
    const headers = { ...apiHeaders(await apiToken(request, ADMIN)), 'X-Hotel-Subdomain': HOTEL }
    const services = (await (await request.get(`${API}/api/cms/services?limit=200`, { headers })).json()).items as Array<{
      id: string
      code: string
      image: { id: string } | null
    }>
    const terrace = services.find((s) => s.code === 'terrace') ?? services.find((s) => s.code === 'kitchen')!
    const original = terrace.image?.id ?? null
    const white = await uploadMedia(request, { name: 'white.png', mimeType: 'image/png', buffer: WHITE }, 'category')
    try {
      const set = await request.patch(`${API}/api/cms/services/${terrace.id}`, { headers, data: { image_id: white.id } })
      expect(set.ok(), await set.text()).toBeTruthy()
      for (const theme of ['light', 'dark'] as const) {
        for (const width of [390, 1440]) {
          const page = await guestPage(browser, { theme, width })
          await page.goto(`/venue/${terrace.code}`)
          await page.waitForTimeout(800)
          const ratio = await titleContrast(page)
          expect(ratio, `${terrace.code}, ${theme}, ${width}: название на белом кадре`).toBeGreaterThanOrEqual(TARGET)
          await page.context().close()
        }
      }
    } finally {
      await request.patch(`${API}/api/cms/services/${terrace.id}`, { headers, data: { image_id: original } })
    }
  })

  test('все шапки демо-отеля: 4,5:1 — телефон и ПК, обе темы', async ({ browser, request }) => {
    test.setTimeout(300_000)
    const codes = await venueCodes(request)
    const failures: string[] = []
    let measured = 0
    for (const theme of ['light', 'dark'] as const) {
      for (const width of [390, 1440]) {
        const page = await guestPage(browser, { theme, width })
        for (const code of codes) {
          await page.goto(`/venue/${code}`)
          const shown = await page.getByTestId('guest-venue-name').waitFor({ timeout: 8_000 }).then(() => true, () => false)
          if (!shown) continue
          await page.waitForTimeout(600)
          const ratio = await titleContrast(page)
          measured++
          if (ratio < TARGET) failures.push(`${code} ${theme} ${width}: ${ratio.toFixed(2)}`)
        }
        await page.context().close()
      }
    }
    expect(measured, 'шапок не нашлось — замер пуст').toBeGreaterThan(8)
    expect(failures, 'названия ниже 4,5:1').toEqual([])
  })
})
