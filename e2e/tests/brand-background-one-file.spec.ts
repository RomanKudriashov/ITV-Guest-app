import { type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

import { DEMO_ROOM } from './helpers'
import { brandSession, uploadMedia } from './brandGuest'
import { pngRGBA } from './pngFixture'

/**
 * ФОН БРЕНДА — ОДИН ФАЙЛ НА ЭКРАН (партия 61-хвост).
 *
 * Один кадр бренда рисуют фон страницы, шапка витрины и экран входа. На 1440
 * у Метрополя на каждом экране качались два размера одного кадра — 2400 и
 * 1600, 800 КБ вместо 285. Замер — запросы браузера: сколько разных файлов
 * фона ушло в сеть на холодном заходе экрана.
 *
 * Условие явное: фон бренда — кадр 2600×1460, у него есть и 1600, и 2400.
 */

const WIDE = pngRGBA(2600, 1460, (x, y) => [(x * 3) % 256, (y * 5) % 256, 90, 255])

async function uploadWideBackground(request: APIRequestContext): Promise<string> {
  return (await uploadMedia(request, { name: 'e2e-wide-bg.png', mimeType: 'image/png', buffer: WIDE }, 'brand')).id
}

type Ref = { widths: Array<{ url: string; w: number }> }

/** Объекты кадра фона бренда (`background.imageRef`) где угодно в ответе API. */
function backgroundRefs(body: unknown, out: Ref[] = []): Ref[] {
  if (!body || typeof body !== 'object') return out
  const background = (body as Record<string, unknown>).background as Record<string, unknown> | undefined
  const ref = background?.imageRef as Ref | undefined
  if (ref?.widths?.length) out.push(ref)
  for (const value of Object.values(body)) backgroundRefs(value, out)
  return out
}

const SCREENS: Array<[string, string, string]> = [
  ['вход', '/', 'guest-room-input'],
  ['главная', '/home', 'guest-home'],
  ['меню', '/venue/kitchen', 'guest-menu'],
  ['инфо', '/info', 'guest-nav-info'],
]

for (const [width, height, scale] of [
  [1440, 900, 1],
  [390, 844, 3],
] as const) {
  test(`${width}: фон бренда — один файл на экран`, async ({ browser, request }) => {
    test.setTimeout(240_000)
    const brand = await brandSession(request)
    try {
      await brand.apply({ brand: { background: { kind: 'image', imageAssetId: await uploadWideBackground(request), dim: 0.3 } } })

      // Вход в номер — один раз, дальше каждый экран в новом контексте с тем же
      // токеном: холодный кэш, все запросы фона видны.
      const login = await browser.newContext({ viewport: { width, height } })
      const loginPage = await login.newPage()
      await loginPage.goto('/')
      await loginPage.getByTestId('guest-room-input').fill(DEMO_ROOM)
      await loginPage.getByTestId('guest-room-submit').click()
      await expect(loginPage.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
      const storage = await login.storageState()
      await login.close()

      const failures: string[] = []
      for (const [name, path, ready] of SCREENS) {
        const context = await browser.newContext({
          viewport: { width, height },
          deviceScaleFactor: scale,
          storageState: path === '/' ? undefined : storage,
        })
        const page = await context.newPage()
        const requested = new Set<string>()
        const ours = new Map<string, number>()
        page.on('request', (r) => {
          if (r.resourceType() === 'image') requested.add(new URL(r.url()).pathname)
        })
        page.on('response', async (r) => {
          if (!r.url().includes('/api/') || !(r.headers()['content-type'] ?? '').includes('json')) return
          for (const ref of backgroundRefs(await r.json().catch(() => null))) {
            for (const { url, w } of ref.widths) ours.set(new URL(url, r.url()).pathname, w)
          }
        })
        await page.goto(path)
        await expect(page.getByTestId(ready).first()).toBeVisible({ timeout: 30_000 })
        await page.waitForLoadState('networkidle')
        expect(ours.size, `${name}: ответ с фоном бренда не пришёл — замер пуст`).toBeGreaterThan(0)
        const files = [...requested].filter((p) => ours.has(p)).map((p) => `w${ours.get(p)}`)
        if (files.length !== 1) failures.push(`${name}: ${files.sort().join(', ') || 'ни одного'}`)
        await context.close()
      }
      expect(failures, `${width}: файлов фона бренда на экране не один`).toEqual([])
    } finally {
      await brand.restore()
    }
  })
}
