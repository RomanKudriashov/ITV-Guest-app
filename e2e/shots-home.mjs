/**
 * Кадры главной: погода с местным временем и строка состояния номера.
 *
 *     node shots-home.mjs
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { STORAGE_KEYS } from './fixtures/appState.mjs'

const BASE = process.env.BASE ?? 'http://localhost:5183'
const OUT = process.env.OUT ?? '../docs/design/home-blocks'
const ROOM = process.env.ROOM ?? '305'

mkdirSync(path.resolve(OUT), { recursive: true })
const browser = await chromium.launch()

for (const [name, viewport, scale] of [
  ['phone', { width: 390, height: 844 }, 2],
  ['desktop', { width: 1440, height: 900 }, 1],
]) {
  for (const mode of ['dark', 'light']) {
    // Пояс Токио: часы отеля отличаются от гостевых, и на кадре видно, ЗАЧЕМ
    // они нужны — гость в другом поясе.
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: scale,
      locale: 'ru-RU',
      timezoneId: 'Asia/Tokyo',
    })
    const page = await context.newPage()
    await page.goto(BASE)
    await page.evaluate((m) => {
      window.localStorage.clear()
      window.sessionStorage.clear()
      window.localStorage.setItem(STORAGE_KEYS.theme, m)
    }, mode)
    await page.goto(BASE)
    await page.getByTestId('guest-room-input').fill(ROOM)
    await page.getByTestId('guest-room-submit').click()
    await page.getByTestId('guest-home').waitFor({ timeout: 25000 })
    await page.waitForTimeout(3500)
    await page.screenshot({ path: path.join(OUT, `home-${name}-${mode}.png`), animations: 'disabled' })
    console.log(name, mode, 'снято')
    await context.close()
  }
}
await browser.close()
