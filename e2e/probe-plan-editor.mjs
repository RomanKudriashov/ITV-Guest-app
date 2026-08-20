/**
 * ПРОБА (не тест): что происходит в редакторе плана при разметке мышью.
 *
 * Ничего не чинит. Повторяет жест администратора и снимает всё, что можно
 * снять: сколько зон было, что пришло с сервера, какие события долетели до
 * страницы, сколько зон стало. Разводит два случая — «редактор не работает»
 * и «тест устарел».
 */
import { chromium } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5183'
const API = process.env.E2E_API_URL ?? 'http://localhost:8010'
const ADMIN = { email: 'owner@crystal.local', password: 'chef12345' }
const TYPE_CODE = process.env.TYPE_CODE ?? 'tip3'

const browser = await chromium.launch({ headless: process.env.HEADED !== '1' })
const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200))
})
page.on('pageerror', (e) => errors.push(`исключение: ${String(e).slice(0, 200)}`))

await page.goto(`${BASE}/login`)
await page.evaluate(() => window.localStorage.clear())
await page.goto(`${BASE}/login`)
await page.getByTestId('login-email').fill(ADMIN.email)
await page.getByTestId('login-password').fill(ADMIN.password)
await page.getByTestId('login-submit').click()
await page.waitForURL(/\/cms\//, { timeout: 30_000 })
const token = await page.evaluate(() => window.localStorage.getItem('itv.cms.access'))

await page.goto(`${BASE}/cms/room-control`)
await page.waitForTimeout(2500)

console.log('\n=== 1. ТИПЫ НОМЕРОВ ===')
const types = await page.evaluate(
  async ([api, tok]) => {
    const r = await fetch(`/api/v1/cms/grms/types`, {
      headers: { Authorization: `Bearer ${tok}`, 'X-Hotel-Subdomain': 'crystal' },
    })
    return { status: r.status, body: await r.text() }
  },
  [API, token],
)
console.log('статус:', types.status)
console.log(
  'коды:',
  (() => {
    try {
      return JSON.parse(types.body).map((t) => t.code).join(', ')
    } catch {
      return types.body.slice(0, 200)
    }
  })(),
)

// Выбор типа
const select = page.getByTestId('grms-type-select')
if (await select.count()) {
  await select.click()
  const option = page.locator(`li[data-value="${TYPE_CODE}"]`)
  if (await option.count()) {
    await option.click()
  } else {
    console.log(`!! типа «${TYPE_CODE}» в списке нет — выбираю первый`)
    await page.locator('li[data-value]').first().click()
  }
} else {
  console.log('!! селектора типов нет вовсе')
}
await page.waitForTimeout(1500)

await page.getByTestId('grms-tab-plan').click()
await page.waitForTimeout(2500)

console.log('\n=== 2. СОСТОЯНИЕ ЭКРАНА ===')
for (const id of [
  'grms-plan-editor',
  'grms-plan-stage',
  'grms-plan-no-frame',
  'grms-plan-tool-zone',
  'grms-plan-save',
]) {
  console.log(`${id}: ${(await page.getByTestId(id).count()) ? 'есть' : '—'}`)
}

const planApi = await page.evaluate(
  async ([api, tok, code]) => {
    const r = await fetch(`/api/v1/cms/grms/types/${code}/plan`, {
      headers: { Authorization: `Bearer ${tok}`, 'X-Hotel-Subdomain': 'crystal' },
    })
    return { status: r.status, body: (await r.text()).slice(0, 400) }
  },
  [API, token, TYPE_CODE],
)
console.log('план с сервера:', planApi.status, planApi.body)

const zonesBefore = await page.locator('[data-testid^="grms-plan-zone-"]').count()
console.log('зон в разметке до жеста:', zonesBefore)

const stage = page.getByTestId('grms-plan-stage')
if (!(await stage.count())) {
  console.log('\n!! сцены нет — рисовать негде. Дальше смысла нет.')
  console.log('ошибки в консоли:', errors.slice(0, 5))
  await browser.close()
  process.exit(0)
}

console.log('\n=== 3. ЖЕСТ АДМИНИСТРАТОРА ===')
// Ловим события ровно так, как их видит страница.
// Слушатели — НА ДОКУМЕНТЕ: сцена перерисовывается, и повешенные на неё
// теряются вместе со старым узлом. Первая версия пробы на этом и соврала,
// показав «событий 0» там, где события шли.
await page.evaluate(() => {
  window.__seen = []
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
    document.addEventListener(
      type,
      (e) => {
        const onStage = e.target instanceof Element && e.target.closest('[data-testid="grms-plan-stage"]')
        window.__seen.push(`${type}${onStage ? ' НА СЦЕНЕ' : ' мимо: ' + (e.target?.dataset?.testid ?? e.target?.tagName)}`)
      },
      true,
    )
  }
})

await page.getByTestId('grms-plan-tool-zone').click()
await page.waitForTimeout(300)
console.log(
  'инструмент «зона» нажат:',
  await page.getByTestId('grms-plan-tool-zone').getAttribute('aria-pressed'),
  '| предпросмотр:',
  await page.getByTestId('grms-plan-preview').locator('input').isChecked().catch(() => '?'),
)
const box = await stage.boundingBox()
const view = page.viewportSize()
console.log('сцена:', JSON.stringify(box), '| окно:', JSON.stringify(view))
const target = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.55 }
console.log(
  'точка жеста:',
  JSON.stringify(target),
  target.y > view.height ? '← ЗА ПРЕДЕЛАМИ ОКНА' : 'в окне',
)
await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55)
await page.mouse.down()
await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.85, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(1500)

let seen = await page.evaluate(() => window.__seen ?? [])
console.log('без прокрутки событий:', seen.length)

// Повтор ТОГО ЖЕ жеста, но точкой, которая ГАРАНТИРОВАННО в окне.
// Инструмент нажимаем ПЕРВЫМ: клик Playwright сам прокручивает кнопку в
// видимую часть и тем самым двигает сцену — координаты, снятые до него,
// протухают.
await page.getByTestId('grms-plan-tool-zone').click()
await page.waitForTimeout(300)
const box2 = await stage.boundingBox()
const v = page.viewportSize()
const top = Math.max(box2.y, 0) + 60
const bottom = Math.min(box2.y + box2.height, v.height) - 60
console.log('сцена сейчас:', JSON.stringify(box2), '| видимая полоса:', top, '…', bottom)
await page.mouse.move(box2.x + box2.width * 0.3, top)
await page.mouse.down()
await page.mouse.move(box2.x + box2.width * 0.5, Math.min(top + 200, bottom), { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(1500)
seen = await page.evaluate(() => window.__seen ?? [])
console.log('событий долетело:', seen.length)
for (const e of seen.slice(-6)) console.log('    (хвост)', e)
const zonesAfter = await page.locator('[data-testid^="grms-plan-zone-"]').count()
console.log('зон в разметке после жеста:', zonesAfter)
console.log('форма зоны открылась:', (await page.getByTestId('grms-plan-form-zone').count()) > 0)

console.log('\n=== 4. ЧТО ЕЩЁ ЕСТЬ НА СЦЕНЕ ===')
const testids = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid^="grms-plan"]')].map((n) => n.dataset.testid),
)
console.log(testids.join(', ') || '—')

console.log('\nошибки в консоли:', errors.length ? errors.slice(0, 5) : 'нет')
await page.screenshot({ path: 'test-results/probe-plan-editor.png', fullPage: true })
console.log('снимок: e2e/test-results/probe-plan-editor.png')
console.log('=== конец ===')
await browser.close()
