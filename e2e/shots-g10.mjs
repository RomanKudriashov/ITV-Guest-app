import { chromium } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { STORAGE_KEYS } from './fixtures/appState.mjs'

/**
 * Кадры G10: три ширины, обе темы, несколько позиций прокрутки — и макет
 * рядом, чтобы сверять попарно, а не по памяти.
 */
const BASE = process.env.BASE ?? 'http://localhost:5183'
const OUT = process.env.OUT ?? '../docs/design/g10-shots'
const MOCKUP = pathToFileURL(
  path.resolve('../docs/design/grms-concept/room-control-mockup.html'),
).href

const WIDTHS = [
  ['phone', { width: 390, height: 844 }],
  ['tablet', { width: 834, height: 1112 }],
  ['desktop', { width: 1440, height: 950 }],
]
const SCROLLS = [0, 240, 700]

const browser = await chromium.launch()

for (const [device, viewport] of WIDTHS) {
  for (const mode of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport, locale: 'ru-RU', deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    await page.goto(BASE)
    await page.evaluate((m) => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem(STORAGE_KEYS.theme, m)
    }, mode)
    await page.goto(BASE)
    await page.getByTestId('guest-room-input').fill('305')
    await page.getByTestId('guest-room-submit').click()
    await page.getByTestId('guest-nav-room').click()
    await page.getByTestId('room-page').waitFor({ timeout: 25000 })
    await page.waitForTimeout(2500)
    for (const y of SCROLLS) {
      await page.evaluate((v) => window.scrollTo(0, v), y)
      await page.waitForTimeout(500)
      await page.screenshot({
        path: `${OUT}/room-${device}-${mode}-scroll${y}.png`,
        animations: 'disabled',
      })
    }
    console.log(device, mode, 'ok')
    await ctx.close()
  }
}

// Макет — в тех же ширинах, для попарной сверки.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.goto(MOCKUP)
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/mockup-desktop.png`, fullPage: true })
await ctx.close()
console.log('макет ok')
await browser.close()
