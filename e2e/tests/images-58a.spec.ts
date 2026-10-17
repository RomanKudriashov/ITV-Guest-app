import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, DEMO_ROOM, HOTEL, guestSession } from './helpers'

/**
 * КАРТИНКИ ПО ШИРИНЕ МЕСТА (партия 58а).
 *
 * Замер 17.10: гостю уходил card 600 на всё — окно позиции 400×700 при DPR 2
 * растягивало его ×3,5, окно «House rules» ×6,3 и показывало 21% кадра. Теперь:
 * API отдаёт ряд ширин, форму кадра и фокус; место выбирает файл по
 * srcset/sizes; видно меньше 60% — фото целиком поверх размытого себя.
 */

type Ref = { src: string; widths: Array<{ w: number; url: string }>; w: number; h: number; focus: { x: number; y: number } }

async function caesar(request: APIRequestContext): Promise<{ id: string; photo: Ref }> {
  const token = await guestSession(request)
  const res = await request.get(`${API}/api/guest/catalog?type=product&point=kitchen`, {
    headers: { 'X-Hotel-Subdomain': HOTEL, Authorization: `Bearer ${token}` },
  })
  expect(res.ok()).toBeTruthy()
  const items = ((await res.json()).categories as Array<{ items: Array<{ id: string; code: string; photos?: Ref[] }> }>).flatMap((c) => c.items)
  const item = items.find((i) => i.code === 'caesar')
  expect(item, 'нет «Цезаря» в меню кухни').toBeTruthy()
  expect(item!.photos?.length, 'у позиции нет объекта картинки').toBeTruthy()
  return { id: item!.id, photo: item!.photos![0] }
}

async function enter(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
}

/** Фото в окне позиции: кадр, его <img> и размытая подложка (если есть). */
async function sheetPhoto(page: Page) {
  const dialog = page.getByRole('dialog').first()
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  const frame = dialog.locator('[data-fit]').first()
  await expect(frame).toBeVisible()
  await expect.poll(() => frame.getAttribute('data-visible-share')).not.toBeNull()
  return frame.evaluate((el) => {
    const imgs = [...el.querySelectorAll('img')]
    const main = imgs.find((i) => i.getAttribute('srcset'))
    const backdrop = imgs.find((i) => getComputedStyle(i).filter.includes('blur'))
    return {
      fit: el.getAttribute('data-fit'),
      share: Number(el.getAttribute('data-visible-share')),
      srcset: main?.getAttribute('srcset') ?? '',
      sizes: main?.getAttribute('sizes') ?? '',
      objectFit: main ? getComputedStyle(main).objectFit : '',
      backdrop: Boolean(backdrop),
    }
  })
}

test('API: у фото ряд ширин не шире кадра, форма и фокус', async ({ request }) => {
  const { photo } = await caesar(request)
  const widths = photo.widths.map((x) => x.w)
  expect(widths, 'ширины не по возрастанию').toEqual([...widths].sort((a, b) => a - b))
  expect(widths.length, 'один файл на все места — как card 600').toBeGreaterThan(1)
  expect(Math.max(...widths)).toBeLessThanOrEqual(photo.w)
  expect(photo.w > 0 && photo.h > 0).toBeTruthy()
  expect(photo.focus.x).toBeGreaterThanOrEqual(0)
  expect(photo.focus.y).toBeLessThanOrEqual(1)
})

async function itemId(request: APIRequestContext, code: string): Promise<string> {
  const token = await guestSession(request)
  const res = await request.get(`${API}/api/guest/catalog?type=product&point=kitchen`, {
    headers: { 'X-Hotel-Subdomain': HOTEL, Authorization: `Bearer ${token}` },
  })
  const items = ((await res.json()).categories as Array<{ items: Array<{ id: string; code: string }> }>).flatMap((c) => c.items)
  const item = items.find((i) => i.code === code)
  expect(item, `нет «${code}» в меню кухни`).toBeTruthy()
  return item!.id
}

test('окно позиции на 1440: srcset/sizes, кадр во всю ширину окна — заполнен по фокусу', async ({ page, request }) => {
  // Партия 58б: кадр сверху во всю ширину окна, форма по фото в 16:9…21:9 —
  // горизонтальный кадр больше не режется колонкой 400 px.
  const { id } = await caesar(request)
  await enter(page, 1440)
  await page.goto(`/venue/kitchen?item=${id}`)
  const photo = await sheetPhoto(page)
  expect(photo.srcset, 'у фото нет srcset').toContain('400w')
  expect(photo.sizes, 'место не назвало свою ширину').not.toBe('')
  expect(photo.sizes).not.toBe('100vw')
  expect(photo.share).toBeGreaterThanOrEqual(0.6)
  expect(photo.fit).toBe('cover')
  expect(photo.backdrop).toBeFalsy()
})

test('окно позиции на 1440, вертикальное фото: видно < 60% — целиком поверх размытого', async ({ page, request }) => {
  // Окно — место «показать целиком»: вертикальный кадр 2:3 в окне 16:9 не
  // режется до трети, а встаёт целиком на размытую копию себя.
  const id = await itemId(request, 'duck-breast')
  await enter(page, 1440)
  await page.goto(`/venue/kitchen?item=${id}`)
  const photo = await sheetPhoto(page)
  expect(photo.share).toBeLessThan(0.6)
  expect(photo.fit).toBe('contain')
  expect(photo.objectFit).toBe('contain')
  expect(photo.backdrop, 'под целым фото нет размытого').toBeTruthy()
})

test('окно позиции на 390: место по форме кадра — режется как прежде, без подложки', async ({ page, request }) => {
  const { id } = await caesar(request)
  await enter(page, 390)
  await page.goto(`/venue/kitchen?item=${id}`)
  const photo = await sheetPhoto(page)
  expect(photo.share).toBeGreaterThanOrEqual(0.6)
  expect(photo.fit).toBe('cover')
  expect(photo.backdrop).toBeFalsy()
})

for (const width of [1440, 390]) {
  test(`карточка меню с вертикальным фото — заполнена по фокусу, без размытого фона (${width})`, async ({ page }) => {
    // Решение тек-лида по снимкам: узкая полоса блюда на размытом фоне — плохо.
    // Карточки, плитки, мозаика — место «заполнить»: всегда cover.
    await enter(page, width)
    await page.evaluate(() => localStorage.setItem('itv.guest.menu-view', 'cards'))
    await page.goto('/venue/kitchen')
    const card = page.getByTestId('guest-item-duck-breast')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await card.scrollIntoViewIfNeeded()
    const frame = card.locator('[data-fit]').first()
    await expect.poll(() => frame.getAttribute('data-visible-share')).not.toBeNull()
    // Кадр 2:3 в карточке — видна заметно меньше 60%: прежде здесь включалось «целиком».
    expect(Number(await frame.getAttribute('data-visible-share'))).toBeLessThan(0.6)
    expect(await frame.getAttribute('data-fit')).toBe('cover')
    expect(await card.locator('[data-testid$="backdrop"]').count(), 'под фото карточки — размытый фон').toBe(0)
  })
}

test('фон-фото на телефоне — image-set, а не простой url под 2x', async ({ page }) => {
  // `sx` читал массив [url, image-set] как брейкпойнты: до 600 px действовал
  // запасной url (файл под 2x), и телефон с DPR 1 качал вдвое шире (замер 17.10).
  await enter(page, 390)
  await page.goto('/venue/kitchen')
  const cover = page.getByTestId('guest-venue-header-cover')
  await expect(cover).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => cover.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('image-set(')
})

test('prefers-reduced-transparency: размытая подложка снимается правилом', async ({ page, request }) => {
  // Подложка есть только у вертикального кадра в окне (партия 58б).
  const id = await itemId(request, 'duck-breast')
  await enter(page, 1440)
  await page.goto(`/venue/kitchen?item=${id}`)
  await sheetPhoto(page)
  // Playwright не эмулирует этот медиазапрос — проверяем, что правило есть и
  // гасит именно подложку.
  const hasRule = await page.evaluate(() => {
    for (const sheet of [...document.styleSheets]) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      for (const rule of [...rules]) {
        if (rule instanceof CSSMediaRule && rule.conditionText.includes('prefers-reduced-transparency')) {
          if ([...rule.cssRules].some((r) => (r as CSSStyleRule).style?.display === 'none')) return true
        }
      }
    }
    return false
  })
  expect(hasRule, 'нет правила, снимающего размытие при reduced-transparency').toBeTruthy()
})
