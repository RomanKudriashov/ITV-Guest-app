import { chromium } from '@playwright/test'

/**
 * Витрина на четырёх языках: главная, заведение и карточка позиции.
 *
 * Проверяем ровно то, что видно глазом: не осталось ли английских строк при
 * китайском интерфейсе, не пусто ли поле, не разъезжается ли арабский (RTL).
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
  await page.evaluate((l) => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('itv.theme-mode', 'dark')
    localStorage.setItem('i18nextLng', l)
  }, lang)
  await page.goto(BASE)
  await page.getByTestId('guest-room-input').fill('305')
  await page.getByTestId('guest-room-submit').click()
  await page.getByTestId('guest-home').waitFor({ timeout: 25000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/home-${lang}.png`, animations: 'disabled' })

  await page.goto(`${BASE}/venue/kitchen`)
  await page.waitForTimeout(2200)
  await page.screenshot({ path: `${OUT}/venue-${lang}.png`, animations: 'disabled' })

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
