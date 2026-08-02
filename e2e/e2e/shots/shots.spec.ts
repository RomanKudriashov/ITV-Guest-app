import { test, expect, type Page } from '@playwright/test'
import { ADMIN, CREDENTIALS, DEMO_ROOM, login, loginToTracker } from '../tests/helpers'

const OUT = '../docs/design/r7-shots'
const WIDTHS: Array<[string, number, number]> = [
  ['phone', 390, 844],
  ['desktop', 1440, 900],
]

async function setMode(page: Page, mode: 'light' | 'dark') {
  await page.evaluate((m) => window.localStorage.setItem('itv.theme-mode', m), mode)
}

async function guestHome(page: Page) {
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home-bento')).toBeVisible({ timeout: 20_000 })
}

for (const [wname, w, h] of WIDTHS) {
  for (const mode of ['dark', 'light'] as const) {
    test(`guest-home ${wname} ${mode}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/'); await setMode(page, mode)
      await guestHome(page)
      await page.waitForTimeout(1200)
      await page.screenshot({ path: `${OUT}/guest-home-${wname}-${mode}.png`, fullPage: false })
    })

    test(`guest-venue ${wname} ${mode}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/'); await setMode(page, mode)
      await guestHome(page)
      await page.getByTestId('guest-home-tile-kitchen').click()
      await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 20_000 })
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}/guest-venue-${wname}-${mode}.png` })
    })

    test(`cms ${wname} ${mode}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/login'); await setMode(page, mode)
      await login(page, ADMIN)
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}/cms-${wname}-${mode}.png` })
    })

    test(`tracker ${wname} ${mode}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/login'); await setMode(page, mode)
      await loginToTracker(page, CREDENTIALS)
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}/tracker-${wname}-${mode}.png` })
    })

    test(`entry ${wname} ${mode}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/')
      await page.evaluate(() => { window.localStorage.clear(); window.sessionStorage.clear() })
      await setMode(page, mode)
      await page.goto('/')
      await expect(page.getByTestId('guest-room-input')).toBeVisible({ timeout: 20_000 })
      await page.waitForTimeout(1800)
      await page.screenshot({ path: `${OUT}/entry-${wname}-${mode}.png` })
    })
  }
}
