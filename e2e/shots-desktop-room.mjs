/**
 * Съёмка десктопной раскладки экрана номера — РУКАМИ.
 *
 *     node shots-desktop-room.mjs
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:5183'
const OUT = process.env.OUT ?? '../docs/design/desktop-layout'
const ROOM = process.env.ROOM ?? '305'

mkdirSync(path.resolve(OUT), { recursive: true })

const browser = await chromium.launch()

for (const width of [1280, 1440, 1920]) {
  for (const mode of ['dark', 'light']) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      locale: 'ru-RU',
    })
    const page = await context.newPage()

    await page.goto(BASE)
    await page.evaluate((m) => {
      window.localStorage.clear()
      window.localStorage.setItem('itv.theme-mode', m)
    }, mode)
    await page.goto(BASE)
    await page.getByTestId('guest-room-input').fill(ROOM)
    await page.getByTestId('guest-room-submit').click()
    await page.getByTestId('guest-nav-room').waitFor({ timeout: 25000 })
    await page.getByTestId('guest-nav-room').click()
    await page.getByTestId('room-two-columns').waitFor({ timeout: 25000 })
    await page.waitForTimeout(1500)

    await page.screenshot({ path: path.join(OUT, `room-${width}-${mode}.png`), fullPage: true })
    console.log(width, mode, 'снято')
    await context.close()
  }
}

await browser.close()
