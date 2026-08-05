import { chromium } from '@playwright/test'

/**
 * Кадры всех гостевых экранов в обеих темах — для сверки «до/после».
 *
 * Запуск: node shots-guest.mjs before | node shots-guest.mjs after
 */
const stage = process.argv[2] ?? 'before'
const BASE = process.env.BASE ?? 'http://192.168.1.79:5183'
const OUT = `../docs/design/guest-panels/${stage}`

const SCREENS = [
  ['home', '/home'],
  ['venue', '/venue/kitchen'],
  ['cart', '/cart'],
  ['orders', '/orders'],
  ['chat', '/chat'],
  ['info', '/info'],
  ['room', '/room'],
]

const browser = await chromium.launch()

for (const mode of ['dark', 'light']) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ru-RU',
    deviceScaleFactor: 2,
  })
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

  for (const [name, path] of SCREENS) {
    await page.goto(BASE + path)
    await page.waitForTimeout(2600)
    await page.screenshot({ path: `${OUT}/${name}-${mode}.png`, animations: 'disabled' })
  }

  // Карточка позиции — шторка поверх витрины.
  await page.goto(`${BASE}/venue/kitchen`)
  await page.waitForTimeout(2200)
  const tile = page.locator('[data-testid^="catalog-item-"]').first()
  if (await tile.count()) {
    await tile.click()
    await page.waitForTimeout(1800)
    await page.screenshot({ path: `${OUT}/item-${mode}.png`, animations: 'disabled' })
  }
  console.log(stage, mode, 'ok')
  await ctx.close()
}
await browser.close()
