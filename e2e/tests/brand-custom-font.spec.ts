import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { ADMIN, login } from './helpers'

/*
  СВОЙ ШРИФТ: «ФАЙЛ ЗАГРУЗИЛСЯ» — НЕ ОТВЕТ.

  Загрузка, запись в тему и выбор в списке могут пройти безупречно, а буквы
  останутся нарисованными запасным шрифтом: правило `@font-face`, положенное не
  в тот документ, не даёт ни ошибки, ни пустого места. Ровно так в заходе 2
  показ рисовался без оформления при всех зелёных проверках.

  Поэтому здесь два вопроса браузеру: каким семейством НАРИСОВАН текст
  (`font-family` у отрисованного узла) и ЗАГРУЖЕН ли этот шрифт на самом деле
  (`document.fonts.check`) — причём внутри рамки показа, у которой свой
  документ.
*/

// Настоящий файл шрифта из нашей же поставки: подделка из случайных байтов
// проверила бы валидацию и ничего не сказала бы про отрисовку.
const FONT_PATH = join(__dirname, '../../frontend/public/fonts/manrope-400-cyrillic.woff2')

async function openBrand(page: Page): Promise<void> {
  await login(page, ADMIN)
  await page.goto('/cms/brand')
  await expect(page.getByTestId('brand-editor')).toBeVisible({ timeout: 20_000 })
}

function frame(page: Page) {
  return page.frameLocator('[data-testid="brand-preview-stage-frame"]')
}

async function uploadFont(page: Page, name: string): Promise<void> {
  await page.getByTestId('brand-font-file').setInputFiles({
    name,
    mimeType: 'font/woff2',
    buffer: readFileSync(FONT_PATH),
  })
  await expect(page.getByTestId('brand-font-custom'), 'о загрузке не сказано ни слова').toBeVisible({
    timeout: 20_000,
  })
}

test.describe('Свой шрифт отеля', () => {
  test('загруженным шрифтом НАРИСОВАН текст витрины, а не только принят файл', async ({ page }) => {
    await openBrand(page)
    await uploadFont(page, 'Уютный Гротеск.woff2')

    const hero = frame(page).getByTestId('guest-home-hero')
    await expect(hero, 'парадная в показе не нарисовалась').toBeVisible({ timeout: 25_000 })

    await expect
      .poll(() => hero.evaluate((node) => getComputedStyle(node).fontFamily), {
        timeout: 15_000,
        message: 'текст витрины рисуется не загруженным шрифтом',
      })
      .toContain('Уютный Гротеск')

    // И он действительно загружен, а не просто назван: браузер отвечает за
    // отрисовку, и спрашиваем мы именно его — в документе РАМКИ.
    const loaded = await frame(page)
      .locator('body')
      .evaluate((body) =>
        (body.ownerDocument as Document & { fonts: FontFaceSet }).fonts.check("16px 'Уютный Гротеск'"),
      )
    expect(loaded, 'шрифт назван в теме, но браузер его не загрузил').toBe(true)
  })

  test('не шрифт — отказ с понятными словами, а не битая тема', async ({ page }) => {
    await openBrand(page)

    await page.getByTestId('brand-font-file').setInputFiles({
      name: 'вроде-шрифт.woff2',
      mimeType: 'font/woff2',
      buffer: Buffer.from('это не шрифт, а текст с правильным расширением', 'utf8'),
    })

    const error = page.getByTestId('brand-font-error')
    await expect(error, 'подделку приняли молча').toBeVisible({ timeout: 20_000 })
    await expect(error).toContainText(/шрифт/i)

    // Тема не пострадала: витрина по-прежнему рисуется.
    await expect(frame(page).getByTestId('guest-home-hero')).toBeVisible({ timeout: 25_000 })
  })

  test('про лицензию сказано рядом с кнопкой, а не мелким шрифтом в согласии', async ({ page }) => {
    await openBrand(page)

    const licence = page.getByTestId('brand-font-licence')
    await expect(licence).toBeVisible()
    await expect(licence).toContainText(/лицензи|право/i)
  })
})
