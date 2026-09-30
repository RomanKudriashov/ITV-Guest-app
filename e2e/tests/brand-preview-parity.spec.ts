import { type Frame, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, signInToCms } from './helpers'
import { brandSession } from './brandGuest'

/**
 * ПОКАЗ = ГОСТЬ: НОМЕР, КАРТОЧКА, АКЦЕНТ, ШРИФТ (партия 24).
 *
 * Ревизия нашла, что показ расходится с витриной не цветом, а содержимым:
 *  - экран «Номер» всегда говорил «управление недоступно» — в сессию показа
 *    клали одно имя отеля, без `room_control_enabled`;
 *  - экран «Карточка» открывал тот же каталог: витрина открывает карточку
 *    параметром `?item=`, а показ его не ставил; и даже открытая, шторка
 *    уходила порталом в документ ПАНЕЛИ, поверх редактора;
 *  - поэтому акцент, который у гостя виден на номере и метках, в показе не
 *    был виден нигде.
 *
 * Условие ставится явно: акцент — заметный цвет, шрифты — Lora/Playfair.
 * Бренд возвращается к исходному.
 */

const ACCENT = '#C2185B'
const ACCENT_RGB = 'rgb(194, 24, 91)'
const FONTS = ['Lora', 'Playfair Display']

async function openScreen(page: Page, id: string): Promise<Frame> {
  await page.getByTestId('brand-preview-screen').click()
  await page.getByTestId(`brand-preview-screen-${id}`).click()
  const handle = await page.getByTestId('brand-preview-stage-frame').elementHandle()
  const frame = await handle!.contentFrame()
  return frame!
}

/** Узлы рамки, чей цвет, фон или рамка — акцент. */
function accentNodes(frame: Frame): Promise<string[]> {
  return frame.evaluate((rgb) => {
    const out = new Set<string>()
    for (const el of document.querySelectorAll('body *')) {
      const box = el.getBoundingClientRect()
      if (!box.width || !box.height) continue
      const cs = getComputedStyle(el)
      if ([cs.color, cs.backgroundColor, cs.borderTopColor].includes(rgb)) {
        out.add(el.closest('[data-testid]')?.getAttribute('data-testid') ?? el.tagName)
      }
    }
    return [...out]
  }, ACCENT_RGB)
}

/** Тексты рамки не шрифтом бренда. */
function foreignText(frame: Frame): Promise<string[]> {
  return frame.evaluate((fonts) => {
    const out: string[] = []
    for (const el of document.querySelectorAll('body *')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue
      const box = el.getBoundingClientRect()
      if (!box.width || !box.height) continue
      const family = getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim()
      if (!fonts.includes(family)) out.push(`«${el.textContent!.trim().slice(0, 20)}» ${family}`)
    }
    return out
  }, FONTS)
}

for (const device of ['phone', 'desktop'] as const) {
  test(`показ совпадает с гостем: номер, карточка, акцент, шрифт — ${device}`, async ({ page, request }) => {
    test.setTimeout(180_000)
    const brand = await brandSession(request)
    try {
      await brand.apply({
        palette: { light: { secondary: ACCENT }, dark: { secondary: ACCENT } },
        typography: { fontFamily: "'Lora', Georgia, serif", headingFontFamily: "'Playfair Display', Georgia, serif" },
      })
      await page.setViewportSize({ width: 1440, height: 1000 })
      await signInToCms(page, ADMIN)
      await page.goto('/cms/brand')
      await expect(page.getByTestId('brand-preview')).toBeVisible({ timeout: 25_000 })
      await page.getByTestId(`brand-preview-device-${device}`).click()

      // Номер: настоящий номер отеля, а не «недоступно».
      let frame = await openScreen(page, 'room')
      await expect(frame.getByTestId('room-pills'), 'номер в показе не нарисован').toBeVisible({ timeout: 25_000 })
      await expect(frame.getByTestId('room-unavailable')).toHaveCount(0)
      await expect
        .poll(() => accentNodes(frame), { message: 'акцент отеля в показе номера не виден' })
        .not.toEqual([])
      expect(await foreignText(frame), 'текст номера в показе не шрифтом отеля').toEqual([])

      // Карточка: открыта В РАМКЕ, и в документе панели её нет.
      frame = await openScreen(page, 'item')
      await expect(frame.getByTestId('guest-item-sheet').first(), 'карточка в показе не открылась').toBeVisible({
        timeout: 25_000,
      })
      await expect(page.getByTestId('guest-item-sheet'), 'шторка показа ушла в панель').toHaveCount(0)
      expect(await foreignText(frame), 'текст карточки в показе не шрифтом отеля').toEqual([])
    } finally {
      await brand.restore()
    }
  })
}
