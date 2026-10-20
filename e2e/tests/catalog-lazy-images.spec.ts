import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, HOTEL } from './helpers'
import { uploadMedia } from './brandGuest'
import { pngRGBA } from './pngFixture'
import { E2E_HOTEL } from '../fixtures/e2eHotel'

/**
 * БОЛЬШОЕ МЕНЮ ГРУЗИТ ТОЛЬКО ПЕРВЫЙ ЭКРАН — И НА ПОВТОРНОМ ЗАХОДЕ (партия 61-хвост).
 *
 * На повторном заходе меню «Саввы» Метрополя браузер качал 250 фото вместо
 * 29 — 10 МБ. React 18 ставил `src` раньше `loading="lazy"`, и картинка,
 * получившая адрес до атрибута, ленивой уже не была; на холодном заходе это
 * пряталось за медленным ответом меню.
 *
 * Условие явное: у каждого раздела свой кадр (кадров столько же, сколько
 * разделов), поэтому файл дальнего раздела качается только тогда, когда
 * браузер полез за дальним разделом. Замер — запросы браузера.
 */

const VENUE = 'lazy-images'
const ROWS_PER_SECTION = 6
/** Запас ленивой загрузки браузера — до 2500 px ниже экрана; берём с верхом. */
const MARGIN = 3000
/** Разных файлов фото позиций на заход: первый экран + запас. */
const MAX_FILES = 12

const SECTIONS = 24

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(300_000)
  const request = await playwright.request.newContext()
  // Свои кадры, различимые между собой: у раздела k — кадр k.
  for (let k = 0; k < SECTIONS; k++) {
    const buffer = pngRGBA(480, 320, (x, y) => [(x + k * 37) % 256, (y + k * 61) % 256, (k * 97) % 256, 255])
    await uploadMedia(request, { name: `e2e-lazy-${k}.png`, mimeType: 'image/png', buffer }, 'category')
  }
  await request.dispose()
  // Разделов столько же, сколько кадров, и кадры берутся по кругу — кадр
  // позиции n совпадает с её разделом.
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  await promisify(execFile)(
    'docker',
    ['compose', 'exec', '-T', 'backend', 'python', 'manage.py', 'seed_big_menu', '--force',
      '--subdomain', E2E_HOTEL, '--service', VENUE, '--latest-photos', String(SECTIONS),
      '--categories', String(SECTIONS), '--items', String(SECTIONS * ROWS_PER_SECTION)],
    { cwd: process.cwd() + '/..', timeout: 300_000 },
  )
})

/** Запросы фото позиций за заход: сколько разных файлов и сколько из них — дальше первого экрана с запасом. */
const MENU_IMAGES = '[data-testid^="guest-item-"] img, [data-testid^="guest-mosaic-tile-"] img'

async function visit(page: Page): Promise<{ files: number; far: string[]; order: string[] }> {
  const requested = new Set<string>()
  const onRequest = (r: { url: () => string; resourceType: () => string }) => {
    if (r.resourceType() === 'image') requested.add(r.url())
  }
  page.on('request', onRequest)
  await page.goto(`/venue/${VENUE}`)
  await expect(page.locator('[data-menu-view]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator(MENU_IMAGES).first()).toBeAttached()
  await page.waitForLoadState('networkidle')
  page.off('request', onRequest)
  return page.evaluate(
    ({ urls, margin, selector }) => {
      const band = window.innerHeight + margin
      const tops = new Map<string, number>()
      const images = [...document.querySelectorAll<HTMLImageElement>(selector)]
      for (const img of images) {
        if (!img.currentSrc) continue
        const top = img.getBoundingClientRect().top + window.scrollY
        tops.set(img.currentSrc, Math.min(tops.get(img.currentSrc) ?? Infinity, top))
      }
      const ours = urls.filter((url) => tops.has(url))
      // Причина бага — порядок: адрес раньше `loading="lazy"` делает картинку
      // нетерпеливой. Порядок атрибутов в DOM — порядок, в котором их ставили.
      const order = images
        .map((img) => img.getAttributeNames())
        .filter((names) => names.includes('src'))
        .filter((names) => ['loading', 'sizes', 'srcset'].some((a) => names.includes(a) && names.indexOf(a) > names.indexOf('src')))
        .map((names) => names.join(' '))
      return {
        order: [...new Set(order)],
        files: ours.length,
        far: ours.filter((url) => tops.get(url)! > band).map((url) => `${url.split('/').slice(-2).join('/')} @${Math.round(tops.get(url)!)}`),
      }
    },
    { urls: [...requested], margin: MARGIN, selector: MENU_IMAGES },
  )
}

for (const [width, height, scale] of [
  [1440, 900, 1],
  [390, 844, 3],
] as const) {
  for (const view of ['cards', 'mosaic'] as const) {
    test(`${width}, ${view}: холодный и повторный заход грузят только первый экран`, async ({ browser, request }) => {
      test.setTimeout(180_000)
      const session = await (
        await request.post(`${API}/api/guest/session`, {
          data: { room_number: '305', language: 'ru' },
          headers: { 'X-Hotel-Subdomain': HOTEL },
        })
      ).json()
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale })
      await context.addInitScript(
        ([token, menuView]) => {
          window.localStorage.setItem('itv.guest.token', token)
          window.localStorage.setItem('itv.guest.menu-view', menuView)
        },
        [session.token, view],
      )
      const page = await context.newPage()
      // Холодный — новая вкладка; повторный — тот же адрес в той же вкладке,
      // как гость, вернувшийся в меню: память вкладки уже тёплая.
      for (const pass of ['холодный', 'повторный']) {
        const { files, far, order } = await visit(page)
        expect(order, `${width}, ${view}: адрес картинки ставится раньше loading/sizes/srcset`).toEqual([])
        expect(files, `${width}, ${view}, ${pass}: фото позиций не грузились — замер пуст`).toBeGreaterThan(0)
        expect(far, `${width}, ${view}, ${pass}: качались фото ниже первого экрана`).toEqual([])
        expect(files, `${width}, ${view}, ${pass}: файлов фото больше первого экрана с запасом`).toBeLessThanOrEqual(MAX_FILES)
      }
      await context.close()
    })
  }
}

test('390: окно позиции по прямой ссылке — меню под ним фото не грузит, после закрытия грузит', async ({ browser, request }) => {
  test.setTimeout(180_000)
  const session = await (
    await request.post(`${API}/api/guest/session`, {
      data: { room_number: '305', language: 'ru' },
      headers: { 'X-Hotel-Subdomain': HOTEL },
    })
  ).json()
  const menu = await (
    await request.get(`${API}/api/v1/guest/catalog?type=product&point=${VENUE}&lang=ru`, {
      headers: { 'X-Hotel-Subdomain': HOTEL, Authorization: `Bearer ${session.token}` },
    })
  ).json()
  // Позиция из дальнего раздела: её кадр в меню у первого экрана не встречается.
  const item = menu.categories[SECTIONS - 1].items[0]

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })
  await context.addInitScript((token) => window.localStorage.setItem('itv.guest.token', token), session.token)
  const page = await context.newPage()
  const requested = new Set<string>()
  page.on('request', (r) => {
    if (r.resourceType() === 'image') requested.add(r.url())
  })
  await page.goto(`/venue/${VENUE}?item=${item.id}`)
  await expect(page.getByTestId('guest-item-sheet')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('guest-item-sheet').locator('img').first()).toHaveJSProperty('complete', true)
  await page.waitForLoadState('networkidle')

  const menuFiles = () =>
    page.evaluate(
      ({ urls, selector }) => {
        const sheet = document.querySelector('[data-testid="guest-item-sheet"]')
        const inSheet = new Set([...(sheet?.querySelectorAll('img') ?? [])].map((img) => img.currentSrc))
        const inMenu = new Set([...document.querySelectorAll<HTMLImageElement>(selector)].map((img) => img.currentSrc))
        return urls.filter((url) => inMenu.has(url) && !inSheet.has(url)).length
      },
      { urls: [...requested], selector: MENU_IMAGES },
    )
  expect(await menuFiles(), 'под окном позиции грузились фото меню').toBe(0)

  await page.getByTestId('guest-item-sheet-close').click()
  await expect(page.getByTestId('guest-item-sheet')).toBeHidden()
  await expect.poll(menuFiles, { message: 'после закрытия окна меню без фото', timeout: 15_000 }).toBeGreaterThan(0)
  await context.close()
})
