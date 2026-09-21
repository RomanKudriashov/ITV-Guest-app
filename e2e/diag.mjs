import { chromium } from '@playwright/test'
const HOTEL='https://crystal.app.147.45.245.172.sslip.io'
const width = Number(process.argv[2] || 1440), height = width < 600 ? 844 : 900
const ROUNDS = Number(process.argv[3] || 20)

const b = await chromium.launch()
const page = await b.newPage({ locale:'ru-RU', viewport:{width,height} })

// Сеть: что ответил сервер по каждой картинке
const net = new Map()
page.on('response', async r => {
  const u = r.url()
  if (!/guest-media|\.webp|\.jpg|\.png/.test(u)) return
  let size = '-'
  try { size = (await r.body()).length } catch { size = 'н/д' }
  net.set(u, { status: r.status(), type: r.headers()['content-type'] ?? '-', size })
})
const failed = []
page.on('requestfailed', r => failed.push({ url: r.url(), err: r.failure()?.errorText }))

await page.goto(`${HOTEL}/`)
await page.evaluate(()=>{localStorage.clear();sessionStorage.clear()})
await page.goto(`${HOTEL}/`)
await page.getByTestId('guest-browse-only').click()
await page.getByTestId('guest-home').waitFor({state:'visible',timeout:40000})

async function covers() {
  return page.$$eval('[data-testid^="guest-home-tile-"] img', imgs =>
    imgs.map(i => ({
      src: i.currentSrc || i.src,
      natural: i.naturalWidth,
      opacity: Number(getComputedStyle(i).opacity),
      complete: i.complete,
      tile: i.closest('[data-testid^="guest-home-tile-"]')?.getAttribute('data-testid') ?? '?',
    })),
  )
}

let blankTotal = 0
const report = []
for (let round = 1; round <= ROUNDS; round += 1) {
  await page.waitForTimeout(1200)
  const rows = await covers()
  const blank = rows.filter(r => r.opacity === 0 || r.natural === 0)
  if (blank.length) {
    blankTotal += blank.length
    for (const r of blank) {
      const n = net.get(r.src)
      report.push(`круг ${round} ${width}px · ${r.tile} · natural=${r.natural} opacity=${r.opacity} complete=${r.complete} · сервер: ${n ? `${n.status} ${n.type} ${n.size}Б` : 'ЗАПРОСА НЕ БЫЛО'}`)
    }
  }
  // Заход в заведение и возврат
  const tile = page.locator('[data-testid^="guest-home-tile-"]').first()
  await tile.click()
  await page.waitForTimeout(900)
  await page.goBack()
  await page.getByTestId('guest-home').waitFor({state:'visible',timeout:30000})
}
console.log(`ширина ${width}px, кругов ${ROUNDS}: пустых обложек ${blankTotal}`)
for (const line of report.slice(0, 14)) console.log('  ' + line)
const mediaFailed = failed.filter(f => /guest-media|\.webp/.test(f.url))
if (mediaFailed.length) console.log('  запросы картинок, которые НЕ УШЛИ:', mediaFailed.slice(0,5))
else console.log('  запросов картинок с ошибкой сети: нет')
await b.close()
