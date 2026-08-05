import { chromium } from '@playwright/test'
const b = await chromium.launch()
const p = await b.newPage({ viewport: {width: 900, height: 900}, locale: 'ru-RU' })
await p.goto('http://localhost:5183')
await p.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await p.goto('http://localhost:5183')
await p.getByTestId('guest-room-input').fill('305')
await p.getByTestId('guest-room-submit').click()
await p.getByTestId('guest-nav-room').click()
await p.getByTestId('room-page').waitFor({ timeout: 20000 })
await p.waitForTimeout(2500)
for (const id of ['room-pill-temp','room-pill-lit','room-pill-curtain','room-pill-blackout','room-pill-cleaning','room-pill-dnd']) {
  const el = p.getByTestId(id)
  const n = await el.count()
  console.log(id.padEnd(20), n, n ? (await el.innerText()).replace('\n',' ') + ' | тон: ' + await el.getAttribute('data-tone') : '')
}
console.log('порядок в DOM:', await p.locator('[data-testid^="room-pill-"]').evaluateAll(els => els.map(e => e.dataset.testid)))
await b.close()
