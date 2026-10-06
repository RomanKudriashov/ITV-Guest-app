/**
 * ЗАМЕР ПЕРВОГО ЗАХОДА (партия 35, п.65): сколько качает и как быстро рисует.
 *
 * Не тест — инструмент, как `measure-stage.mjs`. С `ADMIN_EMAIL`/`ADMIN_PASSWORD`
 * добавляется сцена ADM-002: вошедший администратор, холодный заход на «Заказы».
 * Гоняется по ПРОД-сборке за
 * nginx как на стенде (TLS, HTTP/2, gzip, настоящий `app.locations.conf`), не
 * по дев-серверу: дев отдаёт сотни модулей по одному и ничего не говорит о
 * том, что получит телефон. HTTP/2 обязателен: на HTTP/1.1 браузер держит
 * шесть соединений, и много мелких частей стоили бы лишних кругов, которых у
 * стенда нет.
 *
 *   node measure-bundle.mjs [base] [runs]
 *   base — по умолчанию https://crystal.guest.localhost:4443 (самоподписанный
 *   сертификат — проверка сертификата в замере выключена)
 *
 * Каждый заход — новый контекст (холодный кэш, пустое хранилище), язык
 * браузера ru-RU (русский словарь — самый тяжёлый из четырёх), окно 390,
 * сеть — пресет DevTools «Fast 3G» (1,6 Мбит/с вниз, 750 Кбит/с вверх,
 * задержка 562,5 мс). Время — от начала навигации до появления маркера экрана
 * (наблюдатель в странице, без опроса), медиана по заходам.
 */
import { chromium } from '@playwright/test'
import { statSync } from 'node:fs'

const BASE = process.argv[2] || 'https://crystal.guest.localhost:4443'
const RUNS = Number(process.argv[3] ?? 5)
const THEME = process.env.THEME_LABEL ?? ''
// Каталог сборки — чтобы назвать и размер без сжатия (по сети он сжат).
const DIST = process.env.DIST ?? ''
const FAST_3G = {
  offline: false,
  latency: 562.5,
  downloadThroughput: (1.6 * 1024 * 1024 * 0.9) / 8,
  uploadThroughput: (750 * 1024 * 0.9) / 8,
}
const SCENES = [
  { name: 'гость /r/305 → главная', path: '/r/305', marker: '[data-testid="guest-home"]' },
  { name: 'панель /admin → вход', path: '/admin', marker: '[data-testid="login-email"]' },
]
// ADM-002: вошедший администратор, холодный заход на «Заказы» — до первой
// строки списка. Только если учётка задана окружением (пароль в файл не пишется).
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  SCENES.push({ name: 'панель /admin/orders (вошёл) → строки заказов', path: '/admin/orders', marker: '[data-testid^="orders-row-"]', staff: true })
}
const only = process.env.SCENE

function kind(url) {
  const path = new URL(url).pathname
  if (path.startsWith('/assets/') && path.endsWith('.js')) return 'js'
  if (path.endsWith('.css')) return 'css'
  if (path.startsWith('/api/') || path.startsWith('/ws/')) return 'api'
  if (path.startsWith('/fonts/') || /\.(woff2?|ttf|otf)$/.test(path)) return 'font'
  if (/\.(jpe?g|png|webp|avif)$/.test(path)) return 'image'
  if (path === '/' || path.endsWith('.html') || !path.includes('.')) return 'html'
  return 'other'
}

async function once(browser, scene) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'ru-RU', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  if (scene.staff) {
    // Node не разрешает *.localhost (браузер — да): локально вход идёт прямо в
    // бэкенд (`LOGIN_API=http://localhost:8010`), отель — заголовком, как у панели.
    const login = await context.request.post(`${process.env.LOGIN_API ?? BASE}/api/staff/auth/login`, {
      data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
      headers: { 'X-Hotel-Subdomain': new URL(BASE).hostname.split('.')[0] },
    })
    if (!login.ok()) throw new Error(`вход администратора: ${login.status()}`)
    const { access, refresh } = await login.json()
    await context.addInitScript(([a, r]) => {
      localStorage.setItem('itv.cms.access', a)
      localStorage.setItem('itv.cms.refresh', r)
    }, [access, refresh])
  }
  const page = await context.newPage()
  await page.addInitScript((marker) => {
    const seen = () => {
      if (document.querySelector(marker) && !window.__markerAt) window.__markerAt = performance.now()
    }
    new MutationObserver(seen).observe(document, { childList: true, subtree: true })
  }, scene.marker)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Network.emulateNetworkConditions', FAST_3G)
  const urls = new Map()
  const files = {}
  cdp.on('Network.responseReceived', (e) => urls.set(e.requestId, e.response.url))
  cdp.on('Network.loadingFinished', (e) => {
    const url = urls.get(e.requestId)
    if (!url || !url.startsWith('http')) return
    const k = kind(url)
    files[k] ??= { count: 0, wire: 0, list: [] }
    files[k].count += 1
    files[k].wire += e.encodedDataLength
    files[k].list.push(new URL(url).pathname)
  })
  await page.goto(BASE + scene.path, { waitUntil: 'commit' })
  await page.waitForFunction(() => window.__markerAt, null, { timeout: 120_000, polling: 100 })
  // Части, которые экран тянет следом (ленивые), — тоже его цена.
  await page.waitForTimeout(1500)
  const result = await page.evaluate(() => ({
    marker: window.__markerAt,
    fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
  }))
  await context.close()
  return { ...result, files }
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

const browser = await chromium.launch()
for (const scene of SCENES) {
  if (only && !scene.name.includes(only)) continue
  const runs = []
  for (let i = 0; i < RUNS; i += 1) runs.push(await once(browser, scene))
  const js = runs[0].files.js ?? { count: 0, wire: 0, list: [] }
  const css = runs[0].files.css ?? { count: 0, wire: 0 }
  console.log(`\n== ${scene.name}${THEME ? ` [${THEME}]` : ''}`)
  console.log(`   маркер, мс: ${runs.map((r) => Math.round(r.marker)).join(' ')} → медиана ${Math.round(median(runs.map((r) => r.marker)))}`)
  console.log(`   FCP, мс:    ${runs.map((r) => Math.round(r.fcp ?? 0)).join(' ')} → медиана ${Math.round(median(runs.map((r) => r.fcp ?? 0)))}`)
  const raw = DIST ? js.list.reduce((sum, p) => sum + statSync(DIST + p).size, 0) : 0
  console.log(`   JS: файлов ${js.count}, по сети ${(js.wire / 1024).toFixed(1)} КБ${DIST ? `, без сжатия ${(raw / 1024).toFixed(1)} КБ` : ''}; CSS: файлов ${css.count}, ${(css.wire / 1024).toFixed(1)} КБ`)
  for (const [k, v] of Object.entries(runs[0].files)) if (k !== 'js' && k !== 'css') console.log(`   ${k}: ${v.count} шт, ${(v.wire / 1024).toFixed(1)} КБ`)
  console.log(`   JS-файлы: ${js.list.map((p) => p.replace('/assets/', '')).join(', ')}`)
}
await browser.close()
