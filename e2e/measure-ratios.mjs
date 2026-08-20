/**
 * Меряем РЕАЛЬНЫЕ пропорции кадров у гостя на живом стенде.
 *
 * Кроппер обязан предлагать то соотношение, в котором кадр покажут, — а оно
 * задано вёрсткой (фиксированная высота при резиновой ширине) и на глаз не
 * берётся. Меряем на двух ширинах: расхождение между ними и есть ответ на
 * вопрос, можно ли вообще обойтись ОДНИМ кадром на поверхность.
 */
import { chromium } from '@playwright/test'

const HOST = process.env.STAND ?? 'http://localhost:5183'
const ROOM = '305'

const viewports = [
  { label: 'телефон', width: 390, height: 844 },
  { label: 'десктоп', width: 1440, height: 900 },
]

function nearest(r) {
  const known = [['1:1', 1], ['4:3', 4 / 3], ['3:2', 1.5], ['16:9', 16 / 9], ['21:9', 21 / 9], ['3:4', 0.75], ['2:3', 2 / 3]]
  return known.reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a))[0]
}

async function report(page, name, selector) {
  const box = await page.locator(selector).first().boundingBox().catch(() => null)
  if (!box || !box.height) { console.log(`  ${name}: не найдено`); return null }
  const ratio = box.width / box.height
  console.log(`  ${name}: ${Math.round(box.width)}×${Math.round(box.height)} → ${ratio.toFixed(2)} (${nearest(ratio)})`)
  return ratio
}

const browser = await chromium.launch()
for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } })
  console.log(`\n=== ${vp.label} (${vp.width}px)`)
  await page.goto(`${HOST}/`)
  try {
    await page.getByTestId('guest-room-input').fill(ROOM)
    await page.getByTestId('guest-room-submit').click()
  } catch { /* уже внутри */ }
  await page.waitForTimeout(2500)

  await report(page, 'шапка отеля', '[data-testid="guest-home-hero"]')
  await report(page, 'плитка витрины', '[data-testid^="guest-home-tile-"]')
  await report(page, 'логотип в шапке', '[data-testid="guest-brand-logo"]')

  // Заведение: плитка в списке и шапка внутри.
  await page.goto(`${HOST}/venues`).catch(() => {})
  await page.waitForTimeout(1800)
  await report(page, 'плитка заведения', '[data-testid="guest-venue-list"] a, [data-testid="guest-venue-list"] > * > *')
  const venue = page.locator('[data-testid="guest-venue-list"] a').first()
  if (await venue.count()) { await venue.click(); await page.waitForTimeout(1800) }
  await report(page, 'шапка заведения', '[data-testid="guest-venue-header"]')
  await report(page, 'кадр карточки блюда', '[data-testid="guest-menu"] img, [data-testid="guest-menu"] [class*="Kit"]')

  await page.close()
}
await browser.close()
