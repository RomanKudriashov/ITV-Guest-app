/**
 * УКУС/ПРОБА: сокет жив, а кадр потерян — догоняет ли экран опросом.
 *
 * Это тот самый случай, для которого раньше не было запасного пути: опрос
 * включался по состоянию соединения, а соединение здорово. Кадр глотаем на
 * клиенте — так сокет остаётся «онлайн» и для страницы, и для сервера.
 */
import { chromium, request as pwRequest } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5183'
const API = process.env.E2E_API_URL ?? 'http://localhost:8010'
const HOTEL = 'crystal'
const H = (extra = {}) => ({ 'X-Hotel-Subdomain': HOTEL, ...extra })

const api = await pwRequest.newContext()
const session = await (
  await api.post(`${API}/api/guest/session`, {
    data: { room_number: '305', language: 'ru' },
    headers: H(),
  })
).json()
const staff = (
  await (
    await api.post(`${API}/api/staff/auth/login`, {
      data: { email: 'chef@crystal.local', password: 'chef12345' },
      headers: H(),
    })
  ).json()
).access

const catalog = await (
  await api.get(`${API}/api/v1/guest/catalog`, {
    headers: H({ Authorization: `Bearer ${session.token}` }),
  })
).json()
const item = (catalog.categories ?? [])
  .flatMap((c) => c.items ?? [])
  .find((i) => !i.modifier_groups?.length)
const order = await (
  await api.post(`${API}/api/v1/guest/order`, {
    data: { lines: [{ item_id: item.id, quantity: 1 }], service_code: item.service_code },
    headers: H({
      Authorization: `Bearer ${session.token}`,
      'Idempotency-Key': `lost-${Date.now()}`,
    }),
  })
).json()

const browser = await chromium.launch()
const ctx = await browser.newContext({ locale: 'ru-RU' })

// Глотаем ВСЕ снимки заказа, не трогая само соединение.
await ctx.addInitScript(() => {
  const desc = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage')
  Object.defineProperty(WebSocket.prototype, 'onmessage', {
    configurable: true,
    get() {
      return desc.get.call(this)
    },
    set(handler) {
      desc.set.call(this, (event) => {
        if (String(event.data).includes('order.snapshot')) {
          window.__dropped = (window.__dropped ?? 0) + 1
          return
        }
        handler(event)
      })
    },
  })
})

const page = await ctx.newPage()
await page.goto(`${BASE}/`)
await page.evaluate(
  ([t, s]) => {
    window.localStorage.setItem('itv.guest.token', t)
    window.localStorage.setItem('itv.guest.session_id', s)
  },
  [session.token, session.session_id],
)
await page.goto(`${BASE}/orders/${order.id}`)
const current = page.getByTestId('guest-order-current-status')
await current.waitFor({ timeout: 20_000 })

console.log('стартовый статус на экране:', (await current.innerText()).trim())

for (const status of ['accepted', 'preparing', 'on_the_way', 'done']) {
  await api.post(`${API}/api/orders/${order.id}/status`, {
    data: { status },
    headers: H({ Authorization: `Bearer ${staff}` }),
  })
}
console.log('сервер переведён в «Доставлено»; кадров проглочено:',
  await page.evaluate(() => window.__dropped ?? 0))
console.log('«Нет связи» на экране:', (await page.getByTestId('guest-order-offline').count()) > 0)

for (const wait of [5000, 15000, 15000, 15000, 15000]) {
  await page.waitForTimeout(wait)
  const text = (await current.innerText()).trim()
  console.log(`  +${wait / 1000}с → ${text}`)
  if (/Доставлено/i.test(text)) {
    console.log('ДОГНАЛО опросом, без перезагрузки. Проглочено кадров:',
      await page.evaluate(() => window.__dropped ?? 0))
    break
  }
}

await browser.close()
await api.dispose()
