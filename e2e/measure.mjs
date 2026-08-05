import { chromium } from '@playwright/test'
const BASE = process.env.BASE ?? 'http://192.168.1.79:5183'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU', isMobile: true, hasTouch: true })
const page = await ctx.newPage()
const calls = []
page.on('request', (r) => {
  const u = r.url()
  if (/\/api\/v1\/guest\/room\/(state|command)/.test(u)) calls.push({ t: Date.now(), m: r.method(), u: u.split('/guest/')[1] })
})
await page.goto(BASE)
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await page.goto(BASE)
await page.getByTestId('guest-room-input').fill('305')
await page.getByTestId('guest-room-submit').click()

// 1. Открытие экрана: от клика по «Номер» до первого отрисованного контрола.
const t0 = Date.now()
await page.getByTestId('guest-nav-room').click({ timeout: 20000 })
await page.getByTestId('room-control-light.living').waitFor({ timeout: 30000 })
console.log('открытие экрана:', Date.now() - t0, 'мс')

await page.waitForTimeout(2500)
calls.length = 0

// 2. Один тап по строке света: когда строка снова доступна.
const row = page.getByTestId('room-control-light.living')
const t1 = Date.now()
await row.click()
await page.waitForFunction(
  () => document.querySelector('[data-testid="room-control-light.living"]')?.getAttribute('aria-busy') === 'true',
  null, { timeout: 10000 },
).catch(() => console.log('  (обмен не показался)'))
const busyAt = Date.now()
await page.waitForFunction(
  () => !document.querySelector('[data-testid="room-control-light.living"]')?.hasAttribute('aria-busy'),
  null, { timeout: 30000 },
)
console.log('тап: заблокирован через', busyAt - t1, 'мс, разблокирован через', Date.now() - t1, 'мс')
console.log('  запросов на один тап:', calls.length, JSON.stringify(calls.map((c) => c.m + ' ' + c.u)))

// 3. Пять нажатий + подряд на диске.
await page.getByTestId('room-tabs-climate').click()
await page.getByTestId('room-thermostat-ac.1').waitFor({ timeout: 15000 })
await page.waitForTimeout(1500)
calls.length = 0
// Направление выбирается от текущего значения: стенд общий, уставка могла
// остаться на краю диапазона, и упор в край мерил бы не то.
const surface = page.getByTestId('room-thermostat-ac.1-surface')
const before = await surface.getAttribute('aria-valuenow')
const plus = page.getByTestId(
  Number(before) >= 28 ? 'room-thermostat-ac.1-minus' : 'room-thermostat-ac.1-plus',
)
const t2 = Date.now()
let clicked = 0
for (let i = 0; i < 5; i += 1) {
  try { await plus.click({ timeout: 2500 }); clicked += 1 } catch { /* заблокирована */ }
}
const after = await surface.getAttribute('aria-valuenow')
console.log('пять нажатий +:', Date.now() - t2, 'мс · нажатий прошло', clicked, '· уставка', before, '→', after)
await page.waitForTimeout(6000)
console.log('  запросов на пять нажатий:', calls.length, JSON.stringify(calls.map((c) => c.m + ' ' + c.u)))
await browser.close()
