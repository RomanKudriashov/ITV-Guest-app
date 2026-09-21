import { chromium } from '@playwright/test'
const HOTEL='https://crystal.app.147.45.245.172.sslip.io'
const width=Number(process.argv[2]||1440), ROUNDS=Number(process.argv[3]||20)
const b=await chromium.launch()
const page=await b.newPage({locale:'ru-RU',viewport:{width,height:width<600?844:900}})
await page.goto(`${HOTEL}/`)
await page.evaluate(()=>{localStorage.clear();sessionStorage.clear()})
await page.goto(`${HOTEL}/`)
await page.getByTestId('guest-browse-only').click()
await page.getByTestId('guest-home').waitFor({state:'visible',timeout:40000})

/*
  Меряем ТОЛЬКО обложки, которые рисует KitImage, и ТОЛЬКО те, что в видимой
  области: у карточек меню `loading="lazy"`, и незагруженная картинка за
  экраном — правильное состояние, а не дефект. Парадная отеля сюда не входит:
  она рисуется другим компонентом, и мешать их в одну кучу значит мерить не
  то, что чинили.
*/
const shot = (selector, where) => page.$$eval(selector, (nodes, where) =>
  nodes
    .filter(n => {
      const r = n.getBoundingClientRect()
      return r.bottom > 0 && r.top < window.innerHeight && r.width > 0 && r.height > 0
    })
    .map(n => ({ where, natural: n.naturalWidth, opacity: Number(getComputedStyle(n).opacity) })), where)

const settle = async () => {
  await page.waitForLoadState('networkidle').catch(()=>{})
  await page.waitForTimeout(1500)
}

let home=0, homeBad=0, venue=0, venueBad=0
const bad=[]
for (let r=1;r<=ROUNDS;r+=1) {
  await settle()
  for (const c of await shot('[data-testid^="guest-home-tile-"] img','главная')) {
    home++; if (c.natural===0||c.opacity===0){homeBad++;bad.push(`круг ${r} главная natural=${c.natural} opacity=${c.opacity}`)}
  }
  await page.locator('[data-testid^="guest-home-tile-"]').first().click()
  await settle()
  for (const c of await shot('main img','заведение+меню')) {
    venue++; if (c.natural===0||c.opacity===0){venueBad++;bad.push(`круг ${r} заведение+меню natural=${c.natural} opacity=${c.opacity}`)}
  }
  await page.goBack()
  await page.getByTestId('guest-home').waitFor({state:'visible',timeout:30000})
}
console.log(`ширина ${width}px, кругов ${ROUNDS}`)
console.log(`  обложки главной:      проверок ${home}, пустых ${homeBad}`)
console.log(`  заведение и карточки: проверок ${venue}, пустых ${venueBad}`)
for (const l of bad.slice(0,10)) console.log('  ' + l)
await b.close()
