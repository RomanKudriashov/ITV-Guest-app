import { chromium } from '@playwright/test'

/**
 * Кадры G12: типовые карточки заявок, витрина консьержа и раздел «Об отеле».
 * Телефон, обе темы.
 *
 * Заказы кладёт САМ БРАУЗЕР — токеном своей сессии, взятым из localStorage
 * после входа по номеру. Заказ, созданный мимо сессии, гость бы не увидел:
 * `/guest/order/{id}` ищет только в заказах ЭТОЙ сессии.
 *
 * Запуск: node shots-g12.mjs
 */
const BASE = process.env.BASE ?? 'http://localhost:5183'
const API = process.env.API ?? 'http://localhost:8010/api/v1'
const HOTEL = process.env.HOTEL ?? 'crystal'
const ROOM = process.env.ROOM ?? '305'
const OUT = '../docs/design/g12-shots'

const browser = await chromium.launch()

/** Значение поля заявки — правдоподобное, по типу поля. */
function fieldValue(field) {
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  if (field.field_type === 'time') return '14:00'
  if (field.field_type === 'date') return day
  if (field.field_type === 'count' || field.field_type === 'number') return String(field.min_value ?? 2)
  if (field.field_type === 'select') return String(field.options?.[0]?.value ?? '')
  return 'Рейс SU 6003, встречаем у выхода B'
}

for (const mode of ['dark', 'light']) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ru-RU',
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.evaluate((m) => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('itv.theme-mode', m)
  }, mode)
  await page.goto(BASE)
  await page.getByTestId('guest-room-input').fill(ROOM)
  await page.getByTestId('guest-room-submit').click()
  await page.getByTestId('guest-home').waitFor({ timeout: 25000 })

  const token = await page.evaluate(() => localStorage.getItem('itv.guest.token'))
  const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }
  const get = async (path) => (await page.request.get(`${API}${path}`, { headers })).json()
  // Ключ идемпотентности обязателен: заказ, отправленный дважды, не должен
  // становиться двумя.
  // Ключ уникален на прогон: тот же ключ с другим телом — конфликт, и это
  // правильно, но кадры пересниматься должны.
  const run = Date.now()
  let key = 0
  const post = async (path, data) => {
    const response = await page.request.post(`${API}${path}`, {
      headers: { ...headers, 'Idempotency-Key': `g12-${run}-${mode}-${(key += 1)}` },
      data,
    })
    const body = await response.json()
    if (!body.id) console.log(`заказ не оформлен (${response.status()}):`, JSON.stringify(body))
    return body
  }

  // --- Заказ каждого вида карточки -----------------------------------------
  const orders = {}

  const products = await get('/guest/catalog?type=product&point=kitchen')
  // Блюдо БЕЗ обязательных модификаторов: у стейка спрашивают прожарку, и
  // заказ без неё честно не оформляется.
  let dish = null
  for (const candidate of (products.categories ?? []).flatMap((c) => c.items ?? [])) {
    const detail = await get(`/guest/item/${candidate.id}`)
    if (!(detail.modifier_groups ?? []).some((g) => g.is_required)) {
      dish = candidate
      break
    }
  }
  orders.delivery = (await post('/guest/order', {
    lines: [{ item_id: dish.id, quantity: 2 }],
    timing: 'asap',
  })).id

  const services = await get('/guest/catalog?type=service_request&point=concierge')
  const request = (services.categories ?? [])
    .flatMap((c) => c.items ?? [])
    .find((i) => i.code === 'airport-pickup')
  const full = await get(`/guest/item/${request.id}`)
  const values = {}
  for (const field of full.request_fields ?? []) values[field.code] = fieldValue(field)
  orders.request = (await post('/guest/order', {
    lines: [{ item_id: request.id, quantity: 1 }],
    field_values: values,
  })).id

  const slots = await get('/guest/catalog?type=slot&point=spa')
  const massage = (slots.categories ?? []).flatMap((c) => c.items ?? [])[0]
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const grid = await get(`/guest/slots?item_id=${massage.id}&date=${day}`)
  const free = (grid.slots ?? []).find((s) => s.available)
  orders.booking = (await post('/guest/order', {
    lines: [{ item_id: massage.id, quantity: 1 }],
    slot_start: free?.starts_at,
  })).id

  // --- Кадры ---------------------------------------------------------------
  for (const [kind, id] of Object.entries(orders)) {
    if (!id) {
      console.log(`нет заказа для карточки ${kind}`)
      continue
    }
    await page.goto(`${BASE}/orders/${id}`)
    await page.getByTestId('guest-order-facts').waitFor({ timeout: 15000 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${OUT}/card-${kind}-${mode}.png`, animations: 'disabled' })
  }

  // КАРТОЧКИ ПОЕЗДКИ здесь нет, и это не пропуск. Ни у одного демо-отеля нет
  // сервиса типа `transfer` — трансфер живёт разделом консьержа, — а подменять
  // вид в ответе бесполезно: живой заказ тут же приходит сокетом и возвращает
  // настоящий. Раскладка поездки проверяется сторожем
  // `tests/guest-order-cards.spec.ts`, где подмена держится до первой сверки.

  // --- Витрина консьержа и «Об отеле» --------------------------------------
  for (const [name, path] of [
    ['concierge', '/venue/concierge'],
    ['info', '/info'],
  ]) {
    await page.goto(`${BASE}${path}`)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/${name}-${mode}.png`, fullPage: true, animations: 'disabled' })
  }

  await ctx.close()
}

await browser.close()
console.log('кадры готовы:', OUT)
