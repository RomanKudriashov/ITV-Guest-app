import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
const b = await chromium.launch()
const p = await b.newPage({ viewport: {width: 430, height: 900}, locale: 'ru-RU' })
await p.goto('http://localhost:5183')
await p.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await p.goto('http://localhost:5183')
await p.getByTestId('guest-room-input').fill('305')
await p.getByTestId('guest-room-submit').click()
await p.getByTestId('guest-nav-room').click()
await p.getByTestId('room-page').waitFor({ timeout: 20000 })
await p.waitForTimeout(3000)
const snap = async (label) => {
  console.log(label,
    '| строк:', await p.locator('[data-testid^="room-control-"]').count(),
    '| план:', await p.getByTestId('room-plan').count(),
    '| вкладки:', await p.getByTestId('room-tabs').count(),
    '| заглушка:', await p.getByTestId('room-unavailable').count(),
    '| плашка:', (await p.getByTestId('room-live-offline').innerText().catch(() => '—')).slice(0, 40))
}
await snap('до обрыва   ')
await run('docker', ['compose', 'stop', 'connector'], { cwd: process.cwd() + '/..' })
// Ждём, пока сервер объявит номер недоступным и снимок доедет до экрана.
await p.waitForTimeout(70000)
await snap('после обрыва')
await p.screenshot({ path: '/tmp/offline3.png' })
await run('docker', ['compose', 'start', 'connector'], { cwd: process.cwd() + '/..' })
await p.waitForTimeout(75000)
await snap('после возврата')
await b.close()
