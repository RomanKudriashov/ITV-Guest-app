/**
 * Кадры подписи под названием позиции — до и после того, как она стала в цвет.
 *
 *     STAGE=before node shots-item-subtitle.mjs   # на чистом дереве
 *     STAGE=after  node shots-item-subtitle.mjs   # с правкой
 *
 * Снимается то, где подпись живёт: список карточек в заведении и открытая
 * шторка позиции. Телефон и десктоп, обе темы — дефект оформления виден только
 * в сравнении, и сравнивать нужно попарно.
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:5183'
const OUT = process.env.OUT ?? '../docs/design/item-subtitle'
const STAGE = process.env.STAGE ?? 'after'
const ROOM = process.env.ROOM ?? '305'
const VENUE = process.env.VENUE ?? 'kitchen'

const DEVICES = [
  { name: 'phone', viewport: { width: 390, height: 844 }, scale: 2 },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, scale: 1 },
]

mkdirSync(path.resolve(OUT), { recursive: true })

const browser = await chromium.launch()

for (const device of DEVICES) {
  for (const mode of ['dark', 'light']) {
    const tag = `${device.name}-${mode}-${STAGE}`
    const context = await browser.newContext({
      viewport: device.viewport,
      deviceScaleFactor: device.scale,
      locale: 'ru-RU',
    })
    const page = await context.newPage()

    await page.goto(BASE)
    await page.evaluate((m) => {
      window.localStorage.clear()
      window.sessionStorage.clear()
      window.localStorage.setItem('itv.theme-mode', m)
    }, mode)
    await page.goto(BASE)
    await page.getByTestId('guest-room-input').fill(ROOM)
    await page.getByTestId('guest-room-submit').click()
    await page.getByTestId('guest-home').waitFor({ timeout: 25000 })

    await page.goto(`${BASE}/venue/${VENUE}`)
    await page.locator('[data-testid^="guest-item-"]').first().waitFor({ timeout: 25000 })
    await page.waitForTimeout(2500)
    await page.screenshot({ path: path.join(OUT, `list-${tag}.png`), animations: 'disabled' })

    // Открытая позиция: та же подпись, тот же приём.
    await page.locator('[data-testid^="guest-item-"]').first().click()
    await page.getByTestId('guest-item-sheet').waitFor({ timeout: 15000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(OUT, `sheet-${tag}.png`), animations: 'disabled' })

    console.log(tag, 'снято')
    await context.close()
  }
}

await browser.close()
