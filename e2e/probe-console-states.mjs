/**
 * ПРОБА (не тест): три исхода каждого экрана консоли.
 *
 * Загрузка / ошибка / пустота — три разных состояния, и оператор должен их
 * различать. Проверяется ИСПОЛНЕНИЕМ: запросу страницы подсовывается 500 или
 * пустой ответ, и снимается то, что осталось на экране. Чтение кода тут не
 * годится — «спиннер навсегда» выглядит в исходниках как обычная загрузка.
 */
import { chromium } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5183'
const PLATFORM = { email: 'platform@itv.local', password: 'platform12345' }

// Экран → его запросы (кроме auth) → пустой ответ нужной формы.
const PAGES = [
  { key: 'overview', nav: 'admin-nav-overview', api: ['/overview'], empty: {} },
  { key: 'fleet', nav: 'admin-nav-fleet', api: ['/fleet'], empty: { items: [], total: 0 } },
  { key: 'modules', nav: 'admin-nav-modules', api: ['/tariffs'], empty: [] },
  { key: 'nodes', nav: 'admin-nav-nodes', api: ['/nodes'], empty: [] },
  { key: 'templates', nav: 'admin-nav-templates', api: ['/templates', '/dictionaries'], empty: [] },
  { key: 'team', nav: 'admin-nav-team', api: ['/team'], empty: [] },
  { key: 'audit', nav: 'admin-nav-audit', api: ['/audit'], empty: [] },
  { key: 'support', nav: 'admin-nav-support', api: ['/impersonations'], empty: [] },
]

const browser = await chromium.launch()

async function login(ctx) {
  const page = await ctx.newPage()
  await page.goto(`${BASE}/admin`)
  await page.evaluate(() => window.localStorage.clear())
  await page.goto(`${BASE}/admin`)
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await page.getByTestId('admin-shell').waitFor({ timeout: 40_000 })
  return page
}

/** Что осталось на экране: спиннер, ошибка, пустота или данные. */
async function readState(page) {
  await page.waitForTimeout(2500)
  const spinner = await page.locator('main .MuiCircularProgress-root').count()
  // Именно `main`: в `body` содержимое тонет в навигации, которая есть всегда.
  const text = (await page.locator('main').innerText().catch(() => '')) || ''
  const alerts = await page.locator('main [role="alert"], main .MuiAlert-root').allInnerTexts()
  return {
    spinner: spinner > 0,
    alerts: alerts.map((a) => a.replace(/\s+/g, ' ').trim()).filter(Boolean),
    // Отбрасываем навигацию и шапку: они есть всегда.
    body: text.replace(/\s+/g, ' ').trim().slice(0, 300),
  }
}

function verdict({ spinner, alerts, body }, mode) {
  if (spinner && !alerts.length) return 'СПИННЕР НАВСЕГДА'
  if (alerts.length) return `сообщение: «${alerts[0].slice(0, 80)}»`
  if (mode === 'empty') return body ? `экран: «${body.slice(0, 110)}»` : 'ПУСТОЕ МЕСТО'
  return 'экран отрисован'
}

const report = []

for (const spec of PAGES) {
  for (const mode of ['норма', 'ошибка 500', 'пустой ответ']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' })

    // Перехват ставится ДО входа: react-query кэширует ответ первой загрузки,
    // и подмена после неё проверяла бы кэш, а не экран.
    if (mode !== 'норма') {
      await ctx.route('**/api/v1/platform/**', async (route) => {
        const url = route.request().url()
        const mine = spec.api.some((p) => url.includes(`/platform${p}`))
        if (!mine) return route.continue()
        if (mode === 'ошибка 500') {
          return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"боль"}' })
        }
        return route.fulfill({
          status: 200, contentType: 'application/json', body: JSON.stringify(spec.empty),
        })
      })
    }

    let page
    try {
      page = await login(ctx)
      await page.getByTestId(spec.nav).click()
      const state = await readState(page)
      report.push([spec.key, mode, verdict(state, mode === 'пустой ответ' ? 'empty' : mode)])
    } catch (e) {
      report.push([spec.key, mode, `не открылась: ${String(e).slice(0, 60)}`])
    }
    await ctx.close()
  }
}

await browser.close()

const w = Math.max(...report.map((r) => r[0].length)) + 2
console.log('\n=== ТРИ ИСХОДА КАЖДОГО ЭКРАНА КОНСОЛИ ===')
let last = ''
for (const [page, mode, result] of report) {
  if (page !== last) console.log('')
  last = page
  console.log(`${page.padEnd(w)} ${mode.padEnd(14)} ${result}`)
}
console.log('\n=== конец ===')
