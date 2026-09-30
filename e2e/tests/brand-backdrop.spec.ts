import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken } from './helpers'
import { brandSession, guestPage } from './brandGuest'
import { pngRGBA } from './pngFixture'

/**
 * ФОН БРЕНДА ЗА ВСЕМИ ЭКРАНАМИ ГОСТЯ, ТЕКСТ НАД НИМ ЧИТАЕМ (партия 25).
 *
 * Фон, выбранный отелем, был виден только на входе. Теперь он под всей
 * оболочкой, а над ним вуаль цветом страницы, плотность которой считается из
 * контраста текста.
 *
 * 1. ВИДЕН: фон — ровный заметный цвет; на каждом экране его пиксели есть.
 * 2. ЧИТАЕМ: фон — фото «шахматка» чёрное/белое, худший случай для любой вуали.
 *    Для каждого текста, который стоит прямо на странице (не на карточке),
 *    текст прячется, снимается то, что под ним, и контраст цвета текста
 *    считается к КАЖДОМУ пикселю. Порог 4,5:1; цвету, который и на чистой
 *    странице ниже 4,5 (так отель поставил сам), — 3:1.
 */

const SCREENS: Array<[string, string, string]> = [
  ['главная', '/home', 'guest-home'],
  ['заведения', '/category/restaurants', 'guest-venue-kitchen'],
  ['меню', '/venue/kitchen', 'guest-menu'],
  ['чат', '/chat', 'guest-chat-composer'],
  ['номер', '/room', 'room-page'],
  ['инфо', '/info', 'guest-nav-info'],
  ['заказы', '/orders', 'guest-nav-orders'],
]

const CHECKER = pngRGBA(1600, 900, (x, y) =>
  (Math.floor(x / 20) + Math.floor(y / 20)) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255],
)

async function uploadBrandImage(request: APIRequestContext): Promise<string> {
  const headers = apiHeaders(await apiToken(request, ADMIN))
  const response = await request.post(`${API}/api/v1/cms/media`, {
    headers,
    multipart: { file: { name: 'checker.png', mimeType: 'image/png', buffer: CHECKER }, kind: 'brand' },
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

async function open(page: Page, path: string, ready: string): Promise<void> {
  await page.goto(path)
  await expect(page.getByTestId(ready).first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1_200)
}

/** Доля пикселей экрана цвета `rgb` (±3). */
async function share(page: Page, rgb: [number, number, number]): Promise<number> {
  const shot = await page.screenshot()
  return page.evaluate(
    async ({ src, rgb }) => {
      const image = new Image()
      image.src = src
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let hit = 0
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - rgb[0]) <= 3 && Math.abs(d[i + 1] - rgb[1]) <= 3 && Math.abs(d[i + 2] - rgb[2]) <= 3) hit++
      }
      return hit / (d.length / 4)
    },
    { src: `data:image/png;base64,${shot.toString('base64')}`, rgb },
  )
}

/** Тексты, стоящие прямо на странице: цвет, контраст к чистой странице, рамка. */
function textsOnPage(page: Page) {
  return page.evaluate(() => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number)
    const lum = ([r, g, b]: number[]) => {
      const ch = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
    }
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
      return (x + 0.05) / (y + 0.05)
    }
    const pageColour = parse(getComputedStyle(document.querySelector('[data-testid="guest-backdrop-veil"]')!).backgroundColor)
    const out: Array<{ label: string; colour: number[]; onPage: number; box: { x: number; y: number; width: number; height: number } }> = []
    for (const el of document.querySelectorAll('main *')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue
      // Рамка — самих БУКВ, а не элемента: блок во всю ширину цепляет чужое
      // (волосяную линию шапки над ним) и мерил бы её, а не фон.
      const range = document.createRange()
      range.selectNodeContents(el)
      const box = range.getBoundingClientRect()
      if (box.width < 4 || box.height < 4 || box.bottom < 0 || box.top > innerHeight) continue
      // ЧТО ПОД ТЕКСТОМ — по слоям в его центре, сверху вниз. Первая
      // картинка или закрашенная поверхность — текст не на странице (фото
      // плитки, карточка). Дошли до `body` — на странице.
      let onPage = false
      const stack = document.elementsFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      for (const e of stack) {
        // Слои фона не ловят указатель и в стопку не попадают: дошли до
        // `body` — под текстом ничего, кроме фона бренда с вуалью.
        if (e === document.body || e === document.documentElement) {
          onPage = true
          break
        }
        if (e === el || e.contains(el)) {
          const cs = getComputedStyle(e)
          const bg = parse(cs.backgroundColor)
          const painted = (bg.length === 4 ? bg[3] > 0 : bg.length === 3) || cs.backgroundImage !== 'none' || cs.backdropFilter !== 'none'
          if (painted && e.getAttribute('data-testid') !== 'guest-backdrop-veil') break
          continue
        }
        const cs = getComputedStyle(e)
        const bg = parse(cs.backgroundColor)
        const painted = (bg.length === 4 ? bg[3] > 0 : bg.length === 3) || cs.backgroundImage !== 'none' || cs.backdropFilter !== 'none'
        if (['IMG', 'VIDEO', 'CANVAS', 'svg'].includes(e.tagName) || painted) break
      }
      if (!onPage) continue
      const colour = parse(getComputedStyle(el).color)
      out.push({
        label: `«${el.textContent!.trim().slice(0, 24)}»`,
        colour,
        onPage: ratio(colour, pageColour),
        box: { x: box.x, y: Math.max(0, box.y), width: box.width, height: Math.min(box.height, innerHeight - Math.max(0, box.y)) },
      })
    }
    return out
  })
}

/** Худший контраст цвета к пикселям в рамке, снятым без текста. */
async function worstContrast(page: Page, colour: number[], box: { x: number; y: number; width: number; height: number }) {
  const shot = await page.screenshot({ clip: box })
  return page.evaluate(
    async ({ src, colour }) => {
      const lum = ([r, g, b]: number[]) => {
        const ch = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
      }
      const image = new Image()
      image.src = src
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      // Полупрозрачный текст глаз видит смешанным с фоном — считаем так же.
      const a = colour.length === 4 ? colour[3] : 1
      let worst = Infinity
      for (let i = 0; i < d.length; i += 4) {
        const px = [d[i], d[i + 1], d[i + 2]]
        const lt = lum(colour.slice(0, 3).map((v, k) => v * a + px[k] * (1 - a)))
        const lp = lum(px)
        worst = Math.min(worst, (Math.max(lt, lp) + 0.05) / (Math.min(lt, lp) + 0.05))
      }
      return worst
    },
    { src: `data:image/png;base64,${shot.toString('base64')}`, colour },
  )
}

test('фон бренда виден на каждом экране гостя', async ({ browser, request }) => {
  test.setTimeout(180_000)
  const brand = await brandSession(request)
  try {
    // Светлый заметный цвет: основной текст держит 4,5 без вуали, и фон
    // виден ровно своим цветом.
    await brand.apply({ brand: { background: { kind: 'solid', color: '#F2D7E0' } } })
    const failures: string[] = []
    for (const width of [390, 1440]) {
      const page = await guestPage(browser, { width, theme: 'light' })
      for (const [name, path, ready] of SCREENS) {
        await open(page, path, ready)
        if ((await share(page, [242, 215, 224])) < 0.03) failures.push(`${name} ${width}: фона бренда не видно`)
      }
      await page.context().close()
    }
    expect(failures).toEqual([])
  } finally {
    await brand.restore()
  }
})

for (const theme of ['light', 'dark'] as const) {
  test(`текст на странице читаем поверх фото-фона — ${theme}`, async ({ browser, request }) => {
    test.setTimeout(300_000)
    const brand = await brandSession(request)
    try {
      const imageAssetId = await uploadBrandImage(request)
      await brand.apply({ brand: { background: { kind: 'image', imageAssetId, dim: 0 } } })
      const page = await guestPage(browser, { width: 390, theme })
      const failures: string[] = []
      let measured = 0
      for (const [name, path, ready] of SCREENS) {
        await open(page, path, ready)
        const texts = await textsOnPage(page)
        await page.addStyleTag({ content: 'main * { color: transparent !important; text-shadow: none !important; caret-color: transparent !important }' })
        for (const text of texts) {
          const need = text.onPage >= 4.5 ? 4.5 : 3
          const worst = await worstContrast(page, text.colour, text.box)
          measured++
          if (worst < need - 0.05) failures.push(`${name}: ${text.label} ${worst.toFixed(2)} < ${need}`)
        }
      }
      await page.context().close()
      expect(failures, 'текст на странице нечитаем поверх фона бренда').toEqual([])
      expect(measured, 'текстов на странице не нашлось — замер пуст').toBeGreaterThanOrEqual(4)
    } finally {
      await brand.restore()
    }
  })
}
