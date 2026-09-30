import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken } from './helpers'
import { brandSession, guestPage } from './brandGuest'
import { pngRGBA } from './pngFixture'

/**
 * ФОН БРЕНДА И ОБЛОЖКА ГЛАВНОЙ — НЕ МЫЛО (партия 25).
 *
 * Адрес собирался из варианта `card` — 600 точек. Обложка и фон растянуты на
 * весь экран: на телефоне с плотностью 3 это втрое меньше экрана, на 1440 —
 * вдвое. Замер — `naturalWidth` картинки, которую браузер реально показывает
 * (адрес берётся из вычисленного `background-image` элемента на экране).
 *
 * Условие явное: фон бренда — картинка 1600×900, загруженная как бренд.
 */

const WIDE = pngRGBA(1600, 900, (x, y) => [(x * 7) % 256, (y * 5) % 256, 120, 255])

async function uploadBrandImage(request: APIRequestContext): Promise<string> {
  const headers = apiHeaders(await apiToken(request, ADMIN))
  const response = await request.post(`${API}/api/v1/cms/media`, {
    headers,
    multipart: { file: { name: 'cover.png', mimeType: 'image/png', buffer: WIDE }, kind: 'brand' },
  })
  expect(response.status(), await response.text()).toBe(201)
  const { id } = await response.json()
  await expect
    .poll(async () => (await (await request.get(`${API}/api/v1/cms/media/${id}`, { headers })).json()).status, {
      timeout: 30_000,
    })
    .toBe('ready')
  return id
}

/** Самая широкая из картинок, которыми фон нарисован внутри `root`. */
function shownWidth(page: Page, rootTestId: string | null): Promise<number> {
  return page.evaluate(async (testId) => {
    const root = testId ? document.querySelector(`[data-testid="${testId}"]`) : document.body
    const urls = new Set<string>()
    for (const el of [root!, ...root!.querySelectorAll('*')]) {
      for (const m of getComputedStyle(el).backgroundImage.matchAll(/url\("?([^")]+)"?\)/g)) {
        if (!m[1].startsWith('data:')) urls.add(m[1])
      }
    }
    let widest = 0
    for (const src of urls) {
      const img = new Image()
      img.src = src
      await img.decode().catch(() => undefined)
      widest = Math.max(widest, img.naturalWidth)
    }
    return widest
  }, rootTestId)
}

for (const width of [390, 1440]) {
  test(`фон бренда и обложка главной — не меньше 1200 точек, ${width}`, async ({ browser, request }) => {
    test.setTimeout(120_000)
    const brand = await brandSession(request)
    try {
      const imageAssetId = await uploadBrandImage(request)
      await brand.apply({ brand: { background: { kind: 'image', imageAssetId, dim: 0.3 } } })

      const entry = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage()
      await entry.goto('/')
      await expect(entry.getByTestId('guest-room-input')).toBeVisible({ timeout: 20_000 })
      await expect.poll(() => shownWidth(entry, null), { message: 'фон входа мыльный' }).toBeGreaterThanOrEqual(1200)
      await entry.context().close()

      const page = await guestPage(browser, { width })
      await expect(page.getByTestId('guest-home-hero')).toBeVisible()
      await expect
        .poll(() => shownWidth(page, 'guest-home-hero'), { message: 'обложка главной мыльная' })
        .toBeGreaterThanOrEqual(1200)
      await page.context().close()
    } finally {
      await brand.restore()
    }
  })
}
