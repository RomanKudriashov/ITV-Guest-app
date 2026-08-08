/**
 * Кадры шторки: стеклянная панель описания на трёх типах блюд.
 *
 *     STAGE=before node shots-sheet-glass.mjs   # на чистом дереве
 *     STAGE=after  node shots-sheet-glass.mjs
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:5183'
const OUT = process.env.OUT ?? '../docs/design/sheet-glass'
const STAGE = process.env.STAGE ?? 'after'

// Три крайних кадра: тёмный, светлый и очень светлый — на них и проверяется,
// что вуаль подбирается, а не задана числом.
const DISHES = [
  ['dark-dish', 'ribeye'],
  ['light-dish', 'caesar'],
  ['bright-dish', 'lemonade'],
]

mkdirSync(path.resolve(OUT), { recursive: true })
const browser = await chromium.launch()

for (const [device, viewport] of [
  ['phone', { width: 430, height: 900 }],
  ['desktop', { width: 1280, height: 900 }],
]) {
  for (const mode of ['dark', 'light']) {
    const context = await browser.newContext({ viewport, locale: 'ru-RU', deviceScaleFactor: 1 })
    const page = await context.newPage()
    await page.goto(BASE)
    await page.evaluate((m) => {
      window.localStorage.clear()
      window.sessionStorage.clear()
      window.localStorage.setItem('itv.theme-mode', m)
    }, mode)
    await page.goto(BASE)
    await page.getByTestId('guest-room-input').fill('305')
    await page.getByTestId('guest-room-submit').click()
    await page.getByTestId('guest-home').waitFor({ timeout: 25000 })

    const session = await page.request.post('http://localhost:8010/api/v1/guest/session', {
      data: { room_number: '305', language: 'ru' },
      headers: { 'X-Hotel-Subdomain': 'crystal' },
    })
    const token = (await session.json()).token

    for (const [label, code] of DISHES) {
      const found = await page.request.get(
        `http://localhost:8010/api/v1/guest/search?q=${encodeURIComponent(code)}`,
        { headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': 'crystal' } },
      )
      const rows = (await found.json()).items ?? []
      const row = rows.find((item) => item.code === code) ?? rows[0]
      if (!row) continue
      await page.goto(BASE + row.route)
      await page.getByTestId('guest-item-sheet').waitFor({ timeout: 20000 })
      await page.waitForTimeout(2500)
      await page.screenshot({
        path: path.join(OUT, `${device}-${mode}-${label}-${STAGE}.png`),
        animations: 'disabled',
      })
    }
    console.log(device, mode, 'снято')
    await context.close()
  }
}
await browser.close()
