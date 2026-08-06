import { chromium } from '@playwright/test'

/** Экран номера после отделки по референсу: телефон и десктоп, обе темы. */
const BASE = process.env.BASE ?? 'http://localhost:5183'
const OUT = process.env.OUT ?? '../docs/design/g9-shots'
const browser = await chromium.launch()

for (const [device, viewport] of [
  ['phone', { width: 430, height: 900 }],
  ['desktop', { width: 1440, height: 950 }],
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
    await page.getByTestId('guest-nav-room').click()
    await page.getByTestId('room-page').waitFor({ timeout: 25000 })
    await page.waitForTimeout(3000)
    await page.screenshot({ path: `${OUT}/room-${device}-${mode}.png`, animations: 'disabled' })

    // Сцены — карточками с подписью.
    const scenes = page.getByRole('tab', { name: /Сцен/i })
    if (await scenes.count()) {
      await scenes.first().click()
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${OUT}/scenes-${device}-${mode}.png`, animations: 'disabled' })
    }

    // Быстрые действия — низ страницы.
    await page.getByTestId('room-quick-actions').scrollIntoViewIfNeeded()
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/quick-${device}-${mode}.png`, animations: 'disabled' })
    console.log(device, mode, 'ok')
    await ctx.close()
  }
}
await browser.close()
