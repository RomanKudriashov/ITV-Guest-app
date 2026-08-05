import { webkit } from '@playwright/test'
const BASE = 'http://192.168.1.79:5183'
const OUT = '/Users/olegpronkin/.claude/jobs/aa0fe34b/tmp'
const browser = await webkit.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU', isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
const page = await ctx.newPage()
await page.goto(BASE)
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await page.goto(BASE)
await page.getByTestId('guest-room-input').fill('305')
await page.getByTestId('guest-room-submit').click()
await page.getByTestId('guest-nav-room').click({ timeout: 25000 })
await page.getByTestId('room-plan').waitFor({ timeout: 25000 })
await page.waitForTimeout(3000)
console.log(await page.getByTestId('room-plan-lit-living').evaluate((el) => {
  const cs = getComputedStyle(el)
  return { maskImage: cs.maskImage?.slice(0, 60), webkitMask: cs.webkitMaskImage?.slice(0, 60), opacity: cs.opacity }
}))
await page.getByTestId('room-plan').screenshot({ path: `${OUT}/webkit-plate.png` })
console.log('ok')
await browser.close()
