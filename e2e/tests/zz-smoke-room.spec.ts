import { test, expect } from '@playwright/test'
const DEMO_ROOM = '305'
test('дым: экран номера', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-nav-room')).toBeVisible({ timeout: 15000 })
  await page.getByTestId('guest-nav-room').click()
  await expect(page.getByTestId('room-control-light.living')).toBeVisible({ timeout: 15000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: '/tmp/room-dark.png' })
  await page.getByTestId('theme-toggle').click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: '/tmp/room-light.png' })
})
