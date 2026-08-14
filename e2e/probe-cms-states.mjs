/**
 * ПРОБА (не тест): тот же класс в CMS отеля и в трекере.
 *
 * Ничего не чинит — только называет. Каждому экрану подсовывается 500 на его
 * данные (аутентификация и bootstrap проходят как обычно) и снимается, что
 * осталось: спиннер навсегда или внятный отказ.
 */
import { chromium } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5183'
const ADMIN = { email: 'owner@crystal.local', password: 'chef12345' }

const ROUTES = [
  ['CMS: дашборд', '/cms/dashboard'],
  ['CMS: сервисы', '/cms/services'],
  ['CMS: номера', '/cms/rooms'],
  ['CMS: персонал', '/cms/staff'],
  ['CMS: бренд', '/cms/brand'],
  ['CMS: аналитика', '/cms/analytics'],
  ['CMS: настройки', '/cms/settings'],
  ['CMS: уведомления', '/cms/notifications'],
  ['CMS: справочники', '/cms/dictionaries'],
  ['CMS: маркетинг', '/cms/marketing'],
  ['CMS: управление номером', '/cms/room-control'],
  ['CMS: быстрые действия', '/cms/quick-actions'],
  ['CMS: новая позиция', '/cms/menu/items/new'],
  ['CMS: новый раздел', '/cms/menu/categories/new'],
  ['Трекер', '/tracker'],
]

// Через что экран живёт: это пропускаем, иначе не войти и не отрисовать каркас.
const VITAL = ['/staff/auth/', '/cms/bootstrap', '/cms/me']

const browser = await chromium.launch()
const report = []

for (const [name, path] of ROUTES) {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1440, height: 900 } })
  await ctx.route('**/api/v1/**', async (route) => {
    const url = route.request().url()
    if (VITAL.some((v) => url.includes(v))) return route.continue()
    if (!url.includes('/api/v1/cms/') && !url.includes('/api/v1/tracker/')) return route.continue()
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"боль"}' })
  })
  const page = await ctx.newPage()
  try {
    await page.goto(`${BASE}/login`)
    await page.evaluate(() => window.localStorage.clear())
    await page.goto(`${BASE}/login`)
    await page.getByTestId('login-email').fill(ADMIN.email)
    await page.getByTestId('login-password').fill(ADMIN.password)
    await page.getByTestId('login-submit').click()
    await page.waitForTimeout(2000)
    await page.goto(`${BASE}${path}`)
    await page.waitForTimeout(3500)

    const spinner = await page.locator('.MuiCircularProgress-root').count()
    const alerts = (await page.locator('[role="alert"], .MuiAlert-root').allInnerTexts())
      .map((a) => a.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    const text = ((await page.locator('body').innerText().catch(() => '')) || '')
      .replace(/\s+/g, ' ')
      .trim()

    let verdict
    if (spinner > 0 && !alerts.length) verdict = 'СПИННЕР НАВСЕГДА'
    else if (alerts.length) verdict = `отказ виден: «${alerts[0].slice(0, 70)}»`
    else if (text.length < 120) verdict = `ПУСТОЙ ЭКРАН: «${text.slice(0, 60)}»`
    else verdict = `каркас без данных (молча): «${text.slice(0, 220)}»`
    report.push([name, verdict])
  } catch (e) {
    report.push([name, `не открылся: ${String(e).slice(0, 60)}`])
  }
  await ctx.close()
}

await browser.close()
const w = Math.max(...report.map((r) => r[0].length)) + 2
console.log('\n=== CMS ОТЕЛЯ И ТРЕКЕР ПРИ 500 ===')
for (const [name, verdict] of report) console.log(`${name.padEnd(w)} ${verdict}`)
console.log('=== конец ===')
