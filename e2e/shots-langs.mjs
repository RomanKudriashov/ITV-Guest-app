import { chromium } from '@playwright/test'
import { STORAGE_KEYS } from './fixtures/appState.mjs'

/**
 * Витрина на четырёх языках: главная, заведение и карточка позиции.
 *
 * Проверяем ровно то, что видно глазом: не осталось ли английских строк при
 * китайском интерфейсе, не пусто ли поле, не разъезжается ли арабский (RTL).
 *
 * ЯЗЫК СТАВИТСЯ ЗАПРОСОМ `?lang=`, а не ключом в хранилище. Раньше здесь лежал
 * `i18nextLng` — ключ по умолчанию у детектора, — но приложение хранит выбор в
 * `itv.lang` (см. i18n/config.ts). Чужой ключ никто не читал, скрипт молча
 * снимал четыре русских комплекта, и «переключение через localStorage не
 * работает» пошло отсюда. Запрос детектор смотрит ПЕРВЫМ и переживает переход
 * на другой адрес, потому что выбор он тут же кладёт в своё хранилище сам.
 */
const BASE = process.env.BASE ?? 'http://localhost:5183'
const OUT = process.env.OUT ?? '../docs/design/g7-langs'
const LANGS = ['ru', 'en', 'ar', 'zh']

const browser = await chromium.launch()

for (const lang of LANGS) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: lang === 'zh' ? 'zh-CN' : lang === 'ar' ? 'ar' : `${lang}-RU`,
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem(STORAGE_KEYS.theme, 'dark')
  })
  await page.goto(`${BASE}/?lang=${lang}`)
  await page.getByTestId('guest-room-input').fill('305')
  await page.getByTestId('guest-room-submit').click()
  await page.getByTestId('guest-home').waitFor({ timeout: 25000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/home-${lang}.png`, animations: 'disabled' })

  await page.goto(`${BASE}/venue/kitchen`)
  await page.waitForTimeout(2200)
  await page.screenshot({ path: `${OUT}/venue-${lang}.png`, animations: 'disabled' })

  // Экран номера — на нём и плита с планом, и быстрые действия: самое узкое
  // место по длине подписей, и единственное, где раскладка разворачивается
  // вместе с языком, а план — нет.
  await page.goto(`${BASE}/room`)
  await page.getByTestId('room-page').waitFor({ timeout: 25000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/room-${lang}.png`, animations: 'disabled' })

  await page.goto(`${BASE}/venue/kitchen`)
  await page.waitForTimeout(2000)
  const rows = page.locator('[data-testid^="guest-qty-plus-"]')
  if (await rows.count()) {
    await rows.first().locator('xpath=ancestor::*[@data-testid][1]').click()
    await page.getByTestId('guest-item-sheet').waitFor({ timeout: 15000 })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/item-${lang}.png`, animations: 'disabled' })
  }
  console.log(lang, 'ok')
  await ctx.close()
}
await browser.close()
