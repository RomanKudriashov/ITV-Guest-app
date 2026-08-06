import { chromium } from '@playwright/test'
const b = await chromium.launch()
const p = await b.newPage({ viewport: {width: 430, height: 900}, locale: 'ru-RU' })
p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0,300)))
await p.goto('http://localhost:5183')
await p.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await p.goto('http://localhost:5183')
await p.getByTestId('guest-room-input').fill('305')
await p.getByTestId('guest-room-submit').click()
await p.getByTestId('guest-nav-room').click()
await p.getByTestId('room-page').waitFor({ timeout: 20000 })
await p.waitForTimeout(4000)
console.log('строк:', await p.locator('[data-testid^="room-control-"]').count(),
            '| плашка:', await p.getByTestId('room-live-offline').count(),
            '| текст:', await p.getByTestId('room-live-offline').innerText().catch(()=>'-'))
await p.screenshot({ path: '/tmp/offline2.png' })
await b.close()
