import { chromium } from '@playwright/test'

/**
 * Кадры КАРТОЧКИ ПОЗИЦИИ: телефон и десктоп, обе темы, и отдельно — трудные
 * случаи (длинное название, длинный состав, позиция без фотографии).
 *
 * Запуск: node shots-item.mjs before | node shots-item.mjs after
 */
const stage = process.argv[2] ?? 'before'
const BASE = process.env.BASE ?? 'http://localhost:5183'
const OUT = `../docs/design/g7-item-card/${stage}`

/** Экраны, на которых карточка открывается: витрина ресторана и рум-сервис. */
const VENUE = '/venue/kitchen'

const browser = await chromium.launch()

async function openCard(page, index = 0) {
  await page.goto(BASE + VENUE)
  await page.waitForTimeout(2200)
  // Строка каталога опознаётся кнопкой «+» — её testid несёт код позиции.
  const tiles = page.locator('[data-testid^="guest-qty-plus-"]')
  const count = await tiles.count()
  if (!count) return false
  // Открываем карточку кликом по самой строке, а не по «+»: плюс кладёт в
  // корзину, а нам нужна шторка.
  const row = tiles.nth(Math.min(index, count - 1)).locator('xpath=ancestor::*[@data-testid][1]')
  await (await row.count() ? row : tiles.nth(0)).click()
  await page.getByTestId('guest-item-sheet').waitFor({ timeout: 15000 })
  await page.waitForTimeout(1200)
  return true
}

for (const [device, viewport] of [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1440, height: 900 }],
]) {
  for (const mode of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport, locale: 'ru-RU', deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    await page.goto(BASE)
    await page.evaluate((m) => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('itv.theme-mode', m)
    }, mode)
    await page.goto(BASE)
    await page.getByTestId('guest-room-input').fill('305')
    await page.getByTestId('guest-room-submit').click()
    await page.getByTestId('guest-home').waitFor({ timeout: 25000 })

    // Обычная карточка и вторая — на ней проверяем разнообразие данных.
    for (const [name, index] of [['card', 0], ['card-2', 3]]) {
      if (await openCard(page, index)) {
        await page.screenshot({
          path: `${OUT}/${name}-${device}-${mode}.png`,
          animations: 'disabled',
        })
      }
    }
    console.log(stage, device, mode, 'ok')
    await ctx.close()
  }
}
await browser.close()
