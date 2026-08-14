/** Меряет геометрию сцены сразу после открытия вкладки «План». Без жестов. */
import { chromium } from '@playwright/test'
const BASE = 'http://localhost:5183'
const b = await chromium.launch()
const ctx = await b.newContext({ locale: 'ru-RU', viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
await p.goto(`${BASE}/login`)
await p.evaluate(() => localStorage.clear())
await p.goto(`${BASE}/login`)
await p.getByTestId('login-email').fill('owner@crystal.local')
await p.getByTestId('login-password').fill('chef12345')
await p.getByTestId('login-submit').click()
await p.waitForURL(/\/cms\//, { timeout: 30000 })
await p.goto(`${BASE}/cms/room-control`)
await p.waitForTimeout(2500)
await p.getByTestId('grms-type-select').click()
await p.locator('li[data-value]').first().click()
await p.waitForTimeout(1200)
await p.getByTestId('grms-tab-plan').click()
await p.waitForTimeout(2500)
const box = await p.getByTestId('grms-plan-stage').boundingBox()
const v = p.viewportSize()
const y55 = box.y + box.height * 0.55
const y85 = box.y + box.height * 0.85
console.log(JSON.stringify({
  окно: v.height,
  сцена_y: Math.round(box.y),
  сцена_ширина: Math.round(box.width),
  сцена_высота: Math.round(box.height),
  точка_55: Math.round(y55),
  точка_85: Math.round(y85),
  в_окне: y55 <= v.height && y85 <= v.height ? 'ДА' : 'НЕТ',
}, null, 0))
await b.close()
