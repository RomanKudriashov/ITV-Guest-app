import { webkit, request as pwRequest } from '@playwright/test'

/**
 * Кадры состояний экрана номера, которых гость встречает, а мы ни разу не
 * смотрели: PIN, «не удалось», «не подтвердилось», оффлайн, загрузка, обрыв
 * канала. Обе темы, мобильный Safari (WebKit) по сетевому адресу.
 */
const BASE = 'http://192.168.1.79:5183'
const API = 'http://localhost:8010'
const OUT = '../docs/design/g5e-shots'

const api = await pwRequest.newContext()
const staff = await api.post(`${API}/api/staff/auth/login`, {
  data: { email: 'owner@crystal.local', password: 'chef12345' },
  headers: { 'X-Hotel-Subdomain': 'crystal' },
})
const token = (await staff.json()).access
const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': 'crystal' }
const demoEntry = (enabled) =>
  api.post(`${API}/api/v1/cms/grms/access/demo-entry`, { data: { enabled }, headers })

const session = await api.post(`${API}/api/v1/guest/session`, {
  data: { room_number: '305', language: 'ru' },
  headers: { 'X-Hotel-Subdomain': 'crystal' },
})
const guestToken = (await session.json()).token
const live = await (
  await api.get(`${API}/api/v1/guest/room/state`, {
    headers: { Authorization: `Bearer ${guestToken}`, 'X-Hotel-Subdomain': 'crystal' },
  })
).json()

const browser = await webkit.launch()

async function open(mode, { prepare } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'ru-RU', hasTouch: true, deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.evaluate((m) => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('itv.theme-mode', m) }, mode)
  if (prepare) await prepare(page)
  await page.goto(BASE)
  await page.getByTestId('guest-room-input').fill('305')
  await page.getByTestId('guest-room-submit').click()
  await page.getByTestId('guest-nav-room').click({ timeout: 25000 })
  return { ctx, page }
}

for (const mode of ['dark', 'light']) {
  // 1. Загрузка: снимок держим, чтобы застать скелетон.
  {
    const { ctx, page } = await open(mode, {
      prepare: async (p) => {
        await p.route('**/api/v1/guest/room/state', async (route) => {
          await new Promise((r) => setTimeout(r, 6000))
          await route.continue()
        })
      },
    })
    await page.getByTestId('room-skeleton').waitFor({ timeout: 20000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/loading-${mode}.png`, animations: 'disabled' })
    console.log('loading', mode)
    await ctx.close()
  }

  // 2. Оффлайн: снимок недоступности с настоящей геометрией, канал заглушен.
  {
    const { ctx, page } = await open(mode, {
      prepare: async (p) => {
        await p.routeWebSocket('**/ws/**', (ws) => ws.close())
        await p.route('**/api/v1/guest/room/state', (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            ...live, availability: 'unavailable', zones: [],
            message: 'Управление номером временно недоступно. Пожалуйста, обратитесь на ресепшен.',
          }) }))
      },
    })
    await page.getByTestId('room-unavailable').waitFor({ timeout: 20000 })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/offline-${mode}.png`, animations: 'disabled' })
    console.log('offline', mode)
    await ctx.close()
  }

  // 3. Обрыв канала посреди сессии: REST живой, сокет закрыт.
  {
    const { ctx, page } = await open(mode, {
      prepare: async (p) => { await p.routeWebSocket('**/ws/**', (ws) => ws.close()) },
    })
    await page.getByTestId('room-live-offline').waitFor({ timeout: 25000 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${OUT}/link-lost-${mode}.png`, animations: 'disabled' })
    console.log('link-lost', mode)
    await ctx.close()
  }

  // 4. PIN: выключаем демо-вход на время съёмки.
  {
    await demoEntry(false)
    const { ctx, page } = await open(mode)
    await page.getByTestId('room-pin-panel').waitFor({ timeout: 25000 })
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${OUT}/pin-${mode}.png`, animations: 'disabled' })
    // И с ошибкой: неверный код и остаток попыток.
    await page.getByTestId('room-pin-input').fill('0000')
    await page.getByTestId('room-pin-submit').click()
    await page.waitForTimeout(2200)
    await page.screenshot({ path: `${OUT}/pin-error-${mode}.png`, animations: 'disabled' })
    console.log('pin', mode)
    await ctx.close()
    await demoEntry(true)
  }

  // 5. «Не удалось» и «не подтвердилось»: исход команды приходит каналом,
  //    поэтому подставляем его сообщением в сокет.
  for (const [name, result] of [['failed', 'failed'], ['unconfirmed', 'unconfirmed']]) {
    const { ctx, page } = await open(mode, {
      prepare: async (p) => {
        await p.routeWebSocket('**/ws/**', (ws) => {
          ws.onMessage(() => {})
          setTimeout(() => {
            ws.send(JSON.stringify({
              type: 'room.snapshot', room: live,
              command: { commandId: 'demo', controlId: 'light.living', result },
            }))
          }, 2500)
        })
      },
    })
    await page.getByTestId('room-notice').waitFor({ timeout: 25000 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/${name}-${mode}.png`, animations: 'disabled' })
    console.log(name, mode)
    await ctx.close()
  }
}
await browser.close()
