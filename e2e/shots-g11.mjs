import { chromium } from '@playwright/test'

/**
 * Кадры КАРТОЧКИ ПОЗИЦИИ для G11: телефон и десктоп, обе темы, три разные
 * позиции — с полным набором полей, с минимальным и без фотографии.
 *
 * Позиция открывается ССЫЛКОЙ (`?item=<id>`), а не кликом по строке каталога:
 * клик зависит от порядка позиций в меню, и «вторая карточка» на другом стенде
 * оказывалась другой. Идентификатор берём из того же API, что и витрина.
 *
 * Запуск: node shots-g11.mjs before | node shots-g11.mjs after
 */
const stage = process.argv[2] ?? 'before'
const BASE = process.env.BASE ?? 'http://localhost:5183'
const API = process.env.API ?? 'http://localhost:8010/api/v1'
const HOTEL = process.env.HOTEL ?? 'crystal'
const ROOM = process.env.ROOM ?? '305'
const OUT = `../docs/design/g11-item-card/${stage}`

/** Позиции: код и заведение, в котором его открываем. */
const CARDS = [
  // Полный набор: КБЖУ, характеристики, маркеры, обязательная прожарка и добавки.
  { name: 'full', venue: 'kitchen', code: 'ribeye' },
  // Минимум: КБЖУ есть, а характеристик, маркеров и групп нет вовсе.
  { name: 'lean', venue: 'bar', code: 'negroni' },
  // Позиция БЕЗ ДАННЫХ: ни фотографии, ни КБЖУ, ни характеристик, ни групп.
  // В сиде такой нет, поэтому ответ подменяется — проверяется поведение
  // карточки на пустых полях, а не наличие такой позиции в меню.
  { name: 'bare', venue: 'kitchen', code: 'ribeye', strip: true },
]

const browser = await chromium.launch()
const api = await browser.newContext()
const session = await api.request.post(`${API}/guest/session`, {
  data: { room_number: ROOM, language: 'ru' },
  headers: { 'X-Hotel-Subdomain': HOTEL },
})
const token = (await session.json()).token
const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }

/** Идентификатор позиции по коду; без кода — первая позиция заведения. */
async function itemId(venue, code) {
  const menu = await api.request.get(`${API}/guest/menu?venue=${venue}`, { headers })
  const body = await menu.json()
  const items = (body.categories ?? []).flatMap((c) => c.items ?? [])
  if (!items.length) return null
  const found = code ? items.find((i) => i.code === code) : items[0]
  return found ? found.id : items[0].id
}

for (const card of CARDS) {
  card.id = await itemId(card.venue, card.code)
  if (!card.id) console.log(`нет позиции для ${card.name} (${card.venue}/${card.code})`)
}

for (const [device, viewport] of [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1440, height: 900 }],
]) {
  for (const mode of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport, locale: 'ru-RU', deviceScaleFactor: 2 })
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

    for (const card of CARDS) {
      if (!card.id) continue
      if (card.strip) {
        await page.route('**/guest/item/**', async (route) => {
          const response = await route.fetch()
          const body = await response.json()
          await route.fulfill({
            json: {
              ...body,
              images: [],
              nutrition: null,
              characteristics: [],
              allergens: [],
              markers: [],
              badges: [],
              modifier_groups: [],
              description: null,
            },
          })
        })
      } else {
        await page.unroute('**/guest/item/**')
      }
      await page.goto(`${BASE}/venue/${card.venue}?item=${card.id}`)
      try {
        await page.getByTestId('guest-item-sheet').waitFor({ timeout: 15000 })
      } catch {
        console.log(`карточка ${card.name} не открылась на ${device}/${mode}`)
        continue
      }
      await page.waitForTimeout(1200)
      await page.screenshot({ path: `${OUT}/${card.name}-${device}-${mode}.png`, animations: 'disabled' })
    }
    await ctx.close()
  }
}

await browser.close()
console.log('кадры готовы:', OUT)
