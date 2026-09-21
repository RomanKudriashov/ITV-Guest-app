import { chromium } from '@playwright/test'
const HOTEL='https://crystal.app.147.45.245.172.sslip.io'
const width=Number(process.argv[2]), ROUNDS=20
const b=await chromium.launch()
const page=await b.newPage({locale:'ru-RU',viewport:{width,height:width<600?844:900}})
await page.goto(`${HOTEL}/`)
await page.evaluate(()=>{localStorage.clear();sessionStorage.clear()})
await page.goto(`${HOTEL}/`)
await page.getByTestId('guest-browse-only').click()
await page.getByTestId('guest-home').waitFor({state:'visible',timeout:40000})

// ПРОКРУЧИВАЕМ ВСЮ ГЛАВНУЮ: у обложек `loading="lazy"`, и не побывавшая в
// экране картинка не загружается намеренно. Считать её пустой — врать на себя.
async function scrollAll() {
  await page.evaluate(async () => {
    for (let y = 0; y <= document.body.scrollHeight; y += window.innerHeight / 2) {
      window.scrollTo(0, y)
      await new Promise(r => setTimeout(r, 180))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForLoadState('networkidle').catch(()=>{})
  await page.waitForTimeout(1200)
}

let checks=0, blank=0
const bad=[]
for (let r=1;r<=ROUNDS;r+=1) {
  await scrollAll()
  const rows = await page.$$eval('[data-testid^="guest-home-tile-"] img', ns => ns.map(n => ({
    tile: n.closest('[data-testid^="guest-home-tile-"]')?.getAttribute('data-testid'),
    natural: n.naturalWidth, opacity: Number(getComputedStyle(n).opacity),
  })))
  for (const c of rows) {
    checks++
    if (c.natural===0 || c.opacity===0) { blank++; bad.push(`круг ${r}: ${c.tile} natural=${c.natural} opacity=${c.opacity}`) }
  }
  await page.locator('[data-testid^="guest-home-tile-"]').first().click()
  await page.waitForLoadState('networkidle').catch(()=>{})
  await page.waitForTimeout(900)
  await page.goBack()
  await page.getByTestId('guest-home').waitFor({state:'visible',timeout:30000})
}
console.log(`${width}px · кругов ${ROUNDS} · обложек проверено ${checks} · ПУСТЫХ ${blank}`)
for (const l of bad.slice(0,8)) console.log('  '+l)
await b.close()
