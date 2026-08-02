import { expect, test, type Page } from '@playwright/test'

/**
 * Раскладки, которые уже один раз разъехались, — под сторожем.
 *
 * Все три проверки числовые, а не «скриншот похож»: расхождения были именно
 * геометрические (полоса на месте кадра, чип поверх названий разделов, форма по
 * центру вместо низа), и словами такое не ловится.
 */

async function entry(page: Page, mode: 'dark' | 'light'): Promise<void> {
  await page.goto('/')
  await page.evaluate((m) => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.localStorage.setItem('itv.theme-mode', m)
  }, mode)
  await page.goto('/')
  await expect(page.getByTestId('guest-room-input')).toBeVisible({ timeout: 20_000 })
}

async function venueMenu(page: Page, mode: 'dark' | 'light'): Promise<void> {
  await page.goto('/')
  await page.evaluate((m) => {
    window.localStorage.clear()
    window.localStorage.setItem('itv.theme-mode', m)
  }, mode)
  await page.goto('/')
  await page.getByTestId('guest-browse-only').click()
  await expect(page.getByTestId('guest-home-bento')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('guest-home-tile-kitchen').click()
  await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 20_000 })
}

const SIZES: Array<[string, number, number]> = [
  ['телефон', 390, 844],
  ['планшет', 834, 1112],
  ['десктоп', 1440, 900],
]

test.describe('Экран входа — раскладка «Полотно»', () => {
  for (const [label, width, height] of SIZES) {
    for (const mode of ['dark', 'light'] as const) {
      test(`${label}, ${mode}: форма прижата вниз, кадр во всю ширину`, async ({ page }) => {
        await page.setViewportSize({ width, height })
        await entry(page, mode)

        const input = (await page.getByTestId('guest-room-input').boundingBox())!
        // Форма живёт в НИЖНЕЙ половине экрана. Она стояла по центру, и это
        // ровно то расхождение с прототипом, ради которого проверка написана.
        expect(input.y, `${label}/${mode}: поле должно быть внизу`).toBeGreaterThan(height * 0.5)

        // И прижата ВЛЕВО, а не отцентрована: у прототипа колонка у левого края.
        expect(input.x, `${label}/${mode}: колонка у левого края`).toBeLessThan(width * 0.25)

        // Логотип сверху слева, переключатели — сверху справа.
        const logo = (await page.getByTestId('guest-entry-mark').boundingBox())!
        expect(logo.y).toBeLessThan(height * 0.2)
        expect(logo.x).toBeLessThan(width * 0.25)
      })
    }
  }
})

test.describe('Мобильная: строка категорий и плавающий чип', () => {
  for (const mode of ['dark', 'light'] as const) {
    test(`${mode}: не пересекаются при прокрутке`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await venueMenu(page, mode)

      const chip = page
        .locator('[data-testid="guest-identify"], [data-testid="guest-room-chip"]')
        .first()
      const bar = page.getByTestId('guest-category-bar')
      await expect(chip).toBeVisible()
      await expect(bar).toBeVisible()

      // Проверяем в НЕСКОЛЬКИХ точках прокрутки: строка липкая, и разъехаться
      // они могут ровно в тот момент, когда она прилипает.
      for (const offset of [0, 300, 700, 1400]) {
        await page.evaluate((y) => window.scrollTo(0, y), offset)
        await page.waitForTimeout(350)
        const chipBox = (await chip.boundingBox())!
        const barBox = (await bar.boundingBox())!
        expect(
          chipBox.y + chipBox.height,
          `${mode}, прокрутка ${offset}: чип наезжает на строку категорий`,
        ).toBeLessThanOrEqual(barBox.y + 1)
      }
    })
  }
})

test.describe('Карточка позиции', () => {
  for (const mode of ['dark', 'light'] as const) {
    test(`${mode}: кадр от самого верха, крестик поверх него`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await venueMenu(page, mode)
      await page.locator('[data-testid^="guest-item-"]').first().click()

      const sheet = page.getByTestId('guest-item-sheet')
      await expect(sheet).toBeVisible({ timeout: 15_000 })
      await page.waitForTimeout(600)

      const sheetBox = (await sheet.boundingBox())!
      const media = (await sheet.locator('img').first().boundingBox())!
      const close = (await page.getByTestId('guest-item-sheet-close').boundingBox())!

      // Кадр начинается у самого верха карточки: белая полоса высотой в кнопку
      // сдвигала его вниз на ~60px.
      expect(
        media.y - sheetBox.y,
        `${mode}: между верхом карточки и кадром не должно быть полосы`,
      ).toBeLessThan(12)

      // И во всю ширину карточки.
      expect(media.width).toBeGreaterThan(sheetBox.width - 4)

      // Крестик лежит НА кадре, а не над ним.
      expect(close.y).toBeGreaterThanOrEqual(media.y - 1)
      expect(close.y + close.height).toBeLessThanOrEqual(media.y + media.height + 1)
    })
  }
})
