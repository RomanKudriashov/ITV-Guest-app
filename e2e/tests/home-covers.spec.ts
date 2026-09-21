import { expect, test } from './fixtures'

/**
 * ОБЛОЖКИ НА ГЛАВНОЙ ДОЛЖНЫ БЫТЬ ВИДНЫ, А НЕ ПРИСУТСТВОВАТЬ.
 *
 * Дефект со стенда: плитка чёрная, название на месте. Диагноз снял браузер на
 * внешнем стенде, двадцать кругов «главная → заведение → назад»: у пустых
 * плиток `naturalWidth=600`, `complete=true`, сервер отвечал 200
 * `image/webp`, неудачных запросов ноль. Пиксели БЫЛИ. Невидимой картинку
 * делала `opacity: 0` — состояние `loaded` ставится из `onLoad`, а картинка
 * из кэша успевает загрузиться раньше, чем React повесит обработчик.
 *
 * Поэтому проверка смотрит ДВЕ вещи сразу: `naturalWidth > 0` (картинка
 * действительно есть) И `opacity > 0` (её действительно видно). Проверять
 * только наличие элемента бессмысленно — мы уже обжигались на «элемент есть
 * ≠ элемент выглядит», и здесь это ровно тот случай: элемент был всегда.
 *
 * Кругов НЕСКОЛЬКО: на холодном кэше гонку выигрывает обработчик, и один
 * круг зелёный даже на сломанном коде. Ломается оно на тёплом.
 */
const ROUNDS = 6

async function coverState(page: import('@playwright/test').Page) {
  return page.$$eval('[data-testid^="guest-home-tile-"] img', (nodes) =>
    nodes.map((node) => {
      const image = node as HTMLImageElement
      return {
        tile: image.closest('[data-testid^="guest-home-tile-"]')?.getAttribute('data-testid') ?? '?',
        natural: image.naturalWidth,
        opacity: Number(getComputedStyle(image).opacity),
      }
    }),
  )
}

async function browse(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.goto('/')
  await page.getByTestId('guest-browse-only').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 30_000 })
}

for (const width of [1440, 390]) {
  test(`обложки главной нарисованы после возвратов назад (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 })
    await browse(page)

    const blank: string[] = []
    for (let round = 1; round <= ROUNDS; round += 1) {
      // Даём кадрам дорисоваться: проверка про ВИД, а не про скорость.
      await page.waitForTimeout(1200)
      for (const cover of await coverState(page)) {
        if (cover.natural === 0 || cover.opacity === 0) {
          blank.push(
            `круг ${round}: ${cover.tile} — naturalWidth=${cover.natural}, opacity=${cover.opacity}`,
          )
        }
      }
      await page.locator('[data-testid^="guest-home-tile-"]').first().click()
      await page.waitForTimeout(700)
      await page.goBack()
      await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 30_000 })
    }

    expect(blank, `обложки загружены, но не видны:\n${blank.join('\n')}`).toEqual([])
  })
}
