import { type Frame, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, signInToCms } from './helpers'
import { brandSession } from './brandGuest'

/**
 * ЭКРАН ВХОДА В ПОКАЗЕ РИСУЕТ ЧЕРНОВИК, А НЕ ОПУБЛИКОВАННОЕ (партия 25).
 *
 * Экран входа сам спрашивал публичный отель и клал его тему поверх всего —
 * в показе это значило: оператор меняет цвет, а экран входа через мгновение
 * возвращает опубликованный. Черновик возвращался только со следующей правкой.
 *
 * Условие явное: опубликован один шрифт текста, в редакторе выбран другой
 * (не сохранён). В рамке показа на экране входа — второй и ни одного первого.
 * Шрифт, а не цвет: основного цвета на экране входа нет — там белый текст
 * поверх фона.
 *
 * Заголовки — третьим шрифтом (партия 29): с тех пор как заголовок входа
 * рисуется шрифтом заголовков бренда, а не Onest у всех, общий для текста и
 * заголовков опубликованный шрифт законно остаётся в заголовке черновика.
 */

const PUBLISHED = { family: "'Lora', Georgia, serif", name: 'Lora' }
const DRAFT = { family: "'Playfair Display', Georgia, serif", name: 'Playfair Display' }
const HEADING = { family: "'Manrope', system-ui, sans-serif", name: 'Manrope' }

async function stageFrame(page: Page): Promise<Frame> {
  const handle = await page.getByTestId('brand-preview-stage-frame').elementHandle()
  return (await handle!.contentFrame())!
}

/** Сколько текстов рамки нарисовано этим семейством (первым в списке). */
function fontUse(frame: Frame, name: string): Promise<number> {
  return frame.evaluate((n) => {
    let count = 0
    for (const el of document.querySelectorAll('body *')) {
      if (![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim())) continue
      if (getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim() === n) count++
    }
    return count
  }, name)
}

test('экран входа в показе — черновик, а не опубликованный бренд', async ({ page, request }) => {
  test.setTimeout(120_000)
  const brand = await brandSession(request)
  try {
    await brand.apply({ typography: { fontFamily: PUBLISHED.family, headingFontFamily: HEADING.family } })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await signInToCms(page, ADMIN)
    await page.goto('/cms/brand')
    await expect(page.getByTestId('brand-preview')).toBeVisible({ timeout: 25_000 })

    // Черновик: шрифт текста другой, не сохранён.
    await page.getByTestId('brand-font-body').click()
    await page.getByRole('option', { name: DRAFT.name, exact: true }).click()

    await page.getByTestId('brand-preview-screen').click()
    await page.getByTestId('brand-preview-screen-entry').click()
    const frame = await stageFrame(page)
    await expect(frame.getByTestId('guest-room-input')).toBeVisible({ timeout: 25_000 })

    // Черновик виден — и остаётся видным: подмена случалась ПОСЛЕ отрисовки,
    // когда доезжал ответ публичной ручки. Поэтому держим паузу и смотрим снова.
    await expect.poll(() => fontUse(frame, DRAFT.name), { message: 'черновой шрифт на входе не виден' }).toBeGreaterThan(0)
    await page.waitForTimeout(2_500)
    expect(await fontUse(frame, PUBLISHED.name), 'на входе в показе — опубликованный шрифт').toBe(0)
    expect(await fontUse(frame, DRAFT.name), 'черновик на входе подменился').toBeGreaterThan(0)
  } finally {
    await brand.restore()
  }
})
