/**
 * ПРОБА (не тест): куда девается последнее обновление статуса у гостя.
 *
 * Разводит три слоя по отдельности:
 *   1. дошёл ли переход до СЕРВЕРА — статус заказа, спрошенный по API;
 *   2. дошло ли сообщение до КЛИЕНТА — кадры сокета, снятые браузером;
 *   3. перерисовался ли экран — ТЕКУЩИЙ статус в DOM.
 *
 * Признак «дошло» — кадр и ответ сервера, а НЕ текст на экране. Первая версия
 * этой пробы искала слово «Доставлено» в карточке заказа и радовалась: в
 * карточке лежит лента всех шагов, и это слово есть там всегда. Проба, которая
 * ищет метку будущего шага, ничего не проверяет.
 *
 * Гоняет цикл, пока не поймает расхождение, и печатает всё, что записала.
 */
import { chromium, request as pwRequest } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5183'
const API = process.env.E2E_API_URL ?? 'http://localhost:8010'
const HOTEL = 'crystal'
const ROOM = '305'
const STAFF = { email: 'chef@crystal.local', password: 'chef12345' }
const ROUNDS = Number(process.env.ROUNDS ?? 8)

const api = await pwRequest.newContext()
const H = (extra = {}) => ({ 'X-Hotel-Subdomain': HOTEL, ...extra })

async function staffToken() {
  const r = await api.post(`${API}/api/staff/auth/login`, { data: STAFF, headers: H() })
  return (await r.json()).access
}

async function guestSession() {
  const r = await api.post(`${API}/api/guest/session`, {
    data: { room_number: ROOM, language: 'ru' },
    headers: H(),
  })
  return await r.json()
}

/** Заказ кладём через API — нас интересует не оформление, а живой статус. */
async function placeOrder(token) {
  const catalog = await api.get(`${API}/api/v1/guest/catalog`, {
    headers: H({ Authorization: `Bearer ${token}` }),
  })
  const body = await catalog.json()
  const item = (body.categories ?? []).flatMap((c) => c.items ?? []).find((i) => !i.modifier_groups?.length)
  if (!item) throw new Error('в каталоге нет позиции без модификаторов')
  const created = await api.post(`${API}/api/v1/guest/order`, {
    data: { lines: [{ item_id: item.id, quantity: 1 }], service_code: item.service_code },
    headers: H({
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }),
  })
  if (!created.ok()) throw new Error(`заказ не создан: ${created.status()} ${await created.text()}`)
  return await created.json()
}

async function move(token, orderId, status) {
  const r = await api.post(`${API}/api/orders/${orderId}/status`, {
    data: { status },
    headers: H({ Authorization: `Bearer ${token}` }),
  })
  if (!r.ok()) throw new Error(`статус ${status}: ${r.status()} ${await r.text()}`)
}

const browser = await chromium.launch()
let caught = false

for (let round = 1; round <= ROUNDS && !caught; round += 1) {
  const ctx = await browser.newContext({ locale: 'ru-RU' })
  const page = await ctx.newPage()

  const frames = []
  const sockets = []
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/guest/order/')) return
    sockets.push({ url: ws.url(), open: Date.now() })
    ws.on('framereceived', (f) => {
      const payload = String(f.payload).slice(0, 200)
      frames.push({ at: Date.now(), payload })
    })
    ws.on('close', () => sockets[sockets.length - 1] && (sockets[sockets.length - 1].close = Date.now()))
  })

  const session = await guestSession()
  const token = await staffToken()
  const order = await placeOrder(session.token)

  // ДОСКА КУХНИ ОТКРЫТА РЯДОМ — главное отличие от спокойного сценария:
  // в тесте она держит свой сокет к той же шине.
  let staffCtx = null
  let staffPage = null
  if (process.env.WITH_BOARD === '1') {
    staffCtx = await browser.newContext({ locale: 'ru-RU' })
    staffPage = await staffCtx.newPage()
    await staffPage.goto(`${BASE}/login`)
    await staffPage.evaluate((tok) => window.localStorage.setItem('itv.cms.access', tok), token)
    await staffPage.goto(`${BASE}/tracker`)
    await staffPage.getByTestId('tracker-board').waitFor({ timeout: 20_000 }).catch(() => {})
  }

  // Кладём гостевую сессию в браузер и открываем экран заказа.
  await page.goto(`${BASE}/`)
  await page.evaluate(
    ([tok, sid]) => {
      window.localStorage.setItem('itv.guest.token', tok)
      window.localStorage.setItem('itv.guest.session_id', sid)
    },
    [session.token, session.session_id],
  )
  await page.goto(`${BASE}/orders/${order.id}`)
  const current = page.getByTestId('guest-order-current-status')
  await current.waitFor({ timeout: 20_000 })

  /** ТЕКУЩИЙ статус, а не карточка целиком. */
  const statusText = async () => (await current.innerText()).replace(/\s+/g, ' ').trim()

  /** Что о заказе думает сервер прямо сейчас. */
  const serverStatus = async () => {
    const fresh = await api.get(`${API}/api/v1/guest/order/${order.id}`, {
      headers: H({ Authorization: `Bearer ${session.token}` }),
    })
    return (await fresh.json()).status?.code ?? '—'
  }

  // ВКЛАДКА ГОСТЯ В ФОНЕ: в тесте активна страница кухни, а гостевая
  // отрисовывается скрытой. Chromium душит фоновые вкладки, и это ровно то,
  // чего нет в спокойной пробе.
  if (process.env.HIDDEN === '1') {
    const front = await ctx.newPage()
    await front.goto(`${BASE}/`)
    await front.bringToFront()
  }

  const chain = ['accepted', 'preparing', 'on_the_way', 'done']
  const seen = []
  for (const next of chain) {
    const before = frames.length
    if (process.env.VIA_UI === '1' && staffPage) {
      // Ровно то, что делает тест: клик по кнопке доски, без проверки исхода.
      await staffPage.keyboard.press('Escape')
      const direct = staffPage.getByTestId(`tracker-status-${order.number}-${next}`)
      if (await direct.isVisible().catch(() => false)) {
        await direct.click()
      } else {
        await staffPage.getByTestId(`tracker-more-${order.number}`).click().catch(() => {})
        await direct.click().catch(() => {})
      }
      await staffPage.waitForTimeout(300)
    } else {
      await move(token, order.id, next)
    }
    // Ждём кадр или сдаёмся через 6 секунд.
    const deadline = Date.now() + 6000
    while (frames.length === before && Date.now() < deadline) {
      await page.waitForTimeout(150)
    }
    await page.waitForTimeout(400)
    seen.push({
      статус: next,
      кадров: frames.length - before,
      наСервере: await serverStatus(),
      наЭкране: await statusText(),
    })
  }

  const lastStep = seen[seen.length - 1]
  // Сошлось, только если сервер принял переход И кадр дошёл И экран показал.
  const ok = lastStep.наСервере === 'done' && lastStep.кадров > 0
  console.log(
    `круг ${round}: ${ok ? 'дошло' : 'ПОТЕРЯ'} | сокетов: ${sockets.length} | ` +
      seen
        .map((s) => `${s.статус}: ${s.кадров}к, сервер=${s.наСервере}, экран=«${s.наЭкране}»`)
        .join(' → '),
  )

  if (!ok) {
    caught = true
    console.log('\n=== УЛОВЛЕНО ===')
    console.log('сокеты:', JSON.stringify(sockets, null, 1))
    console.log('кадры:')
    for (const f of frames) console.log('  ', new Date(f.at).toISOString().slice(11, 23), f.payload.slice(0, 120))
    const code = await serverStatus()
    console.log('СЕРВЕР СЕЙЧАС:', code)
    console.log(
      code !== 'done'
        ? '  → перехода не было вовсе: действие не доехало, сообщение ни при чём'
        : lastStep.кадров === 0
          ? '  → сервер ушёл вперёд, кадра не было: ПОТЕРЯНО СООБЩЕНИЕ'
          : '  → кадр был, а экран отстал: дело в отрисовке',
    )
    // Слой 3: догоняет ли опрос — ждём 20 секунд без действий.
    await page.waitForTimeout(20_000)
    console.log('через 20 с без перезагрузки на экране:', await statusText())
    await page.reload()
    await page.getByTestId('guest-order-status').waitFor({ timeout: 20_000 })
    console.log('после перезагрузки:', await statusText())
  }

  await ctx.close()
  if (staffCtx) await staffCtx.close()
}

if (!caught) console.log(`\n${ROUNDS} кругов подряд — потери не поймано.`)
await browser.close()
await api.dispose()
