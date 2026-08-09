import { chromium } from '@playwright/test'
import { STORAGE_KEYS } from './fixtures/appState.mjs'

/** Экран номера: пилюли статуса и сцены в обеих темах. */
const BASE = process.env.BASE ?? 'http://localhost:5183'
const OUT = process.env.OUT ?? '../docs/design/g8-room'
const browser = await chromium.launch()

for (const mode of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 844 }, locale: 'ru-RU', deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.evaluate((m) => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem(STORAGE_KEYS.theme, m) }, mode)
  await page.goto(BASE)
  await page.getByTestId('guest-room-input').fill('305')
  await page.getByTestId('guest-room-submit').click()
  await page.getByTestId('guest-nav-room').click()
  await page.getByTestId('room-page').waitFor({ timeout: 25000 })
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${OUT}/pills-${mode}.png`, animations: 'disabled' })

  // Ряд прокручен вправо: блэкаут и уборка живут в конце очереди приоритета.
  await page.getByTestId('room-pills').evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/pills-tail-${mode}.png`, animations: 'disabled' })

  const tab = page.getByRole('tab', { name: /Сцен/i })
  if (await tab.count()) {
    await tab.first().click()
    await page.waitForTimeout(700)
    await page.getByTestId('room-control-scene.night').click()
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${OUT}/scene-${mode}.png`, animations: 'disabled' })
  }
  console.log(mode, 'ok')
  await ctx.close()
}
await browser.close()
