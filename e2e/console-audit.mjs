import { chromium } from '@playwright/test'
import { STORAGE_KEYS } from './fixtures/appState.mjs'
import fs from 'node:fs'

/**
 * Обход платформенной консоли для аудита. ТОЛЬКО ЧТЕНИЕ.
 *
 * Разрушающего не нажимает ничего: ни офбординга, ни очистки, ни удаления,
 * ни отзыва ключей. Три отеля на стенде настоящие и наполнены — их и смотрим.
 *
 * Ловит то, чего не видно в коде: пустые состояния, отсутствие индикаторов
 * загрузки, необъяснённые ошибки, вёрстку на телефоне.
 */
const PLATFORM = process.env.PLATFORM ?? 'https://app.147.45.245.172.sslip.io'
const OUT = process.env.OUT ?? './console-shots'
const OWNER = { email: 'owner@itv.local', password: 'oedykG4u0wNYKlwzTY' }

const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } }
const SECTIONS = ['Сводка', 'Отели', 'Модули и тарифы', 'Он-прем узлы', 'Шаблоны и справочники', 'Команда', 'Аудит']

fs.mkdirSync(OUT, { recursive: true })
const problems = []
const browser = await chromium.launch()

async function open(viewport, theme) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[viewport], locale: 'ru-RU', ignoreHTTPSErrors: true,
  })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`консоль: ${m.text().slice(0, 180)}`) })
  page.on('pageerror', (e) => problems.push(`исключение: ${String(e).slice(0, 180)}`))
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url().slice(0, 130)}`) })

  await page.goto(`${PLATFORM}/admin`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEYS.theme, theme])
  await page.goto(`${PLATFORM}/admin`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('admin-login-email').fill(OWNER.email)
  await page.getByTestId('admin-login-password').fill(OWNER.password)
  await page.getByTestId('admin-login-submit').click()
  await page.waitForTimeout(3500)
  return { ctx, page }
}

async function shot(page, name) {
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' })
}

async function noteEmptyOrBare(page, where) {
  const text = (await page.locator('body').innerText().catch(() => '')) || ''
  if (text.trim().length < 60) problems.push(`пустой экран: ${where}`)
  // Слова, которыми экран сознаётся, что данных нет.
  for (const marker of ['NaN', 'undefined', 'null', '[object Object]']) {
    if (text.includes(marker)) problems.push(`«${marker}» на экране: ${where}`)
  }
}

for (const viewport of ['desktop', 'phone']) {
  for (const theme of ['dark', 'light']) {
    const { ctx, page } = await open(viewport, theme)
    const tag = `${viewport}-${theme}`
    try {
      await shot(page, `${tag}-00-сводка`)
      await noteEmptyOrBare(page, `${tag} сводка`)

      for (const [index, label] of SECTIONS.entries()) {
        const item = page.getByRole('button', { name: label }).first()
        if (!(await item.count())) { problems.push(`нет пункта меню «${label}» (${tag})`); continue }
        await item.click()
        await page.waitForTimeout(2500)
        await noteEmptyOrBare(page, `${tag} ${label}`)
        await shot(page, `${tag}-${String(index + 1).padStart(2, '0')}-${label.replace(/[ /]/g, '_')}`)
      }

      // Карточка отеля: открываем первый настоящий отель из флота.
      await page.getByRole('button', { name: 'Отели' }).first().click()
      await page.waitForTimeout(2500)
      const opener = page.locator('[data-testid^="admin-fleet-open-"]').first()
      if (await opener.count()) {
        await opener.click()
        await page.waitForTimeout(3000)
        await noteEmptyOrBare(page, `${tag} карточка отеля`)
        await shot(page, `${tag}-10-карточка_отеля`)
        // Вкладки внутри карточки, если они есть.
        const tabs = page.getByRole('tab')
        const count = await tabs.count()
        for (let i = 0; i < count; i += 1) {
          await tabs.nth(i).click()
          await page.waitForTimeout(2000)
          const name = (await tabs.nth(i).innerText()).replace(/[ /]/g, '_').slice(0, 24)
          await noteEmptyOrBare(page, `${tag} вкладка ${name}`)
          await shot(page, `${tag}-11-вкладка-${i}-${name}`)
        }
      } else {
        problems.push(`во флоте нечего открыть (${tag})`)
      }

      // Диалог создания отеля — ОТКРЫВАЕМ И ЗАКРЫВАЕМ, ничего не создаём.
      await page.getByRole('button', { name: 'Отели' }).first().click()
      await page.waitForTimeout(2000)
      const create = page.getByTestId('admin-create-open')
      if (await create.count()) {
        await create.click()
        await page.waitForTimeout(1500)
        await shot(page, `${tag}-12-создание_отеля`)
        await page.keyboard.press('Escape')
      }
    } catch (e) {
      problems.push(`${tag}: ${String(e).slice(0, 200)}`)
    }
    await ctx.close()
  }
}

await browser.close()
const counted = new Map()
for (const p of problems) counted.set(p, (counted.get(p) ?? 0) + 1)
console.log(`\nснимки: ${OUT}`)
console.log(`замечаний: ${problems.length} (уникальных ${counted.size})`)
for (const [text, n] of [...counted].sort((a, b) => b[1] - a[1])) console.log(`  ×${n}  ${text}`)
