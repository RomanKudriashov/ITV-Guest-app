import { type Frame, type Locator, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, DEMO_ROOM, signInToCms } from './helpers'
import { brandSession } from './brandGuest'

/**
 * ЗАГОЛОВКИ ВИТРИНЫ — ВЕСОМ БРЕНДА, БЕЗ СИНТЕТИЧЕСКОГО ЖИРНОГО (партия 29).
 *
 * Вес 800 был вписан числом в заголовки главной, шапки заведения, плиток,
 * списка заведений и входа. У шрифтов бренда начертания 800 нет (кроме Onest),
 * и браузер рисовал синтетический жирный — размазанный, с поплывшими
 * засечками. Вход вдобавок был Onest у всех отелей (решение приёмки
 * изменено: шрифт и вес — бренда).
 *
 * Сторож «нет синтетического жирного»: у каждого заголовка вычисленный вес
 * равен весу заголовков бренда, первый шрифт — шрифт заголовков бренда, и
 * начертание этого семейства с этим весом РЕАЛЬНО ЗАГРУЖЕНО (`document.fonts`,
 * статус `loaded`), а не только названо. Превью входа в редакторе — то же.
 *
 * Условие явное: заголовки бренда — Playfair Display (у него нет 800), бренд
 * возвращается.
 */

const HEAD = { family: "'Playfair Display', Georgia, serif", name: 'Playfair Display' }

interface Face {
  family: string
  weight: string
  loaded: boolean
}

async function face(target: Locator): Promise<Face> {
  await expect(target).toBeVisible({ timeout: 20_000 })
  return target.evaluate(async (el) => {
    const style = getComputedStyle(el)
    const family = style.fontFamily.split(',')[0].replace(/["']/g, '').trim()
    const weight = style.fontWeight
    await document.fonts.ready
    const w = Number(weight)
    const loaded = [...document.fonts].some((f) => {
      if (f.family.replace(/["']/g, '') !== family || f.status !== 'loaded') return false
      const [lo, hi = lo] = f.weight.split(' ').map(Number)
      return w >= lo && w <= hi
    })
    return { family, weight, loaded }
  })
}

function expectBrandFace(where: string, got: Face, weight: string) {
  expect(got.family, `${where}: шрифт заголовков бренда`).toBe(HEAD.name)
  expect(got.weight, `${where}: вес заголовков бренда, а не вписанное число`).toBe(weight)
  expect(got.loaded, `${where}: начертание ${HEAD.name} ${weight} не загружено — жирный синтетический`).toBe(true)
}

async function frameOf(page: Page): Promise<Frame> {
  const handle = await page.getByTestId('brand-preview-stage-frame').elementHandle()
  return (await handle!.contentFrame())!
}

test('заголовки витрины и входа — шрифт и вес бренда, начертание загружено', async ({ page, request }) => {
  test.setTimeout(180_000)
  const brand = await brandSession(request)
  const typography = (brand.original.typography ?? {}) as Record<string, unknown>
  const weight = String(typography.fontWeightBold ?? 700)
  try {
    await brand.apply({ typography: { headingFontFamily: HEAD.family } })
    await page.setViewportSize({ width: 390, height: 844 })

    await page.goto('/')
    // Тема отеля на входе приезжает с публичной ручкой — ждём её, а не первый кадр.
    await expect
      .poll(async () => (await face(page.locator('h1').first())).family, { timeout: 20_000 })
      .toBe(HEAD.name)
    expectBrandFace('вход', await face(page.locator('h1').first()), weight)

    await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
    await page.getByTestId('guest-room-submit').click()
    await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
    expectBrandFace('обложка главной', await face(page.locator('h1').first()), weight)
    expectBrandFace(
      'плитка главной',
      await face(page.getByTestId('guest-home-tile-restaurants').locator('p, span, h2, h3').filter({ hasText: /\S/ }).first()),
      weight,
    )

    await page.goto('/venue/kitchen')
    expectBrandFace('шапка заведения', await face(page.getByTestId('guest-venue-name')), weight)

    await page.goto('/category/restaurants')
    expectBrandFace('список заведений', await face(page.locator('h1').first()), weight)

    // Превью входа в редакторе — тот же заголовок.
    await page.setViewportSize({ width: 1440, height: 1000 })
    await signInToCms(page, ADMIN)
    await page.goto('/cms/brand')
    await expect(page.getByTestId('brand-preview')).toBeVisible({ timeout: 25_000 })
    await page.getByTestId('brand-preview-screen').click()
    await page.getByTestId('brand-preview-screen-entry').click()
    const frame = await frameOf(page)
    await expect(frame.getByTestId('guest-room-input')).toBeVisible({ timeout: 25_000 })
    expectBrandFace('превью входа', await face(frame.locator('h1').first()), weight)
  } finally {
    await brand.restore()
  }
})
