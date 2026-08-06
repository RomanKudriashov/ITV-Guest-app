import { chromium } from '@playwright/test'
const b = await chromium.launch()
const p = await b.newPage({ viewport: {width: 430, height: 900}, locale: 'ru-RU' })
p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0,200)))
await p.goto('http://localhost:5183')
await p.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await p.goto('http://localhost:5183')
await p.getByTestId('guest-room-input').fill('305')
await p.getByTestId('guest-room-submit').click()
await p.getByTestId('guest-nav-room').click()
await p.getByTestId('room-page').waitFor({ timeout: 20000 })
await p.waitForTimeout(2000)
const box = async (id) => {
  const el = p.getByTestId(id)
  if (!(await el.count())) return null
  const r = await el.boundingBox()
  return r && { top: Math.round(r.y), bottom: Math.round(r.y + r.height) }
}
for (const y of [0, 100, 300, 600, 1200]) {
  await p.evaluate((v) => window.scrollTo(0, v), y)
  await p.waitForTimeout(400)
  const tops = await p.evaluate(() => {
    const plate = document.querySelector('[data-testid="room-plan"]')?.closest('[style*="position"]') || null
    const els = [...document.querySelectorAll('*')].filter(e => getComputedStyle(e).position === 'sticky')
    return els.map(e => ({ t: getComputedStyle(e).top, h: Math.round(e.getBoundingClientRect().height), id: e.dataset.testid || e.className.slice(0,18) }))
  })
  console.log('  стек:', JSON.stringify(await p.evaluate(() => window.__stack)))
  console.log('  липкие:', JSON.stringify(tops), JSON.stringify(await p.evaluate(() => {
    const e = document.querySelector('[data-debug-top]')
    return e ? { top: e.dataset.debugTop, scale: e.dataset.debugScale, plate: e.dataset.debugPlate } : null
  })))
  const plan = await box('room-plan')
  const tabs = await box('room-tabs')
  const height = await p.evaluate(() => document.documentElement.scrollHeight)
  console.log(`scroll ${String(y).padStart(4)} | план ${JSON.stringify(plan)} | вкладки ${JSON.stringify(tabs)} | док ${height}` +
    (plan && tabs && tabs.top < plan.bottom ? '  ← ПЕРЕКРЫТИЕ' : ''))
}
await b.close()
