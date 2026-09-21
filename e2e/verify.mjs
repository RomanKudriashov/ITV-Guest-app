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
  Считаем ТОЛЬКО то, что в видимой области.

  У карточек меню `loading="lazy"`: картинка за пределами экрана НЕ загружена
  намеренно, и `naturalWidth=0` у неё — правильное состояние, а не дефект.
  Первая версия зонда этого не различала и объявляла пустыми десяток кадров,
  которых браузер ещё и не просил.
*/
const shot = (where) => page.$$eval('img', (nodes, where) =>
  nodes
    .filter(n => /guest-media/.test(n.currentSrc || n.src))
    .filter(n => {
      const r = n.getBoundingClientRect()
      return r.bottom > 0 && r.top < window.innerHeight && r.width > 0 && r.height > 0
    })
    .map(n => ({
      where,
      natural: n.naturalWidth,
      opacity: Number(getComputedStyle(n).opacity),
      src: (n.currentSrc||n.src).slice(-28),
    })), where)

let checksHome=0, badHome=0, checksVenue=0, badVenue=0, checksItems=0, badItems=0
const bad=[]
for (let r=1;r<=ROUNDS;r+=1) {
  await page.waitForTimeout(1100)
  for (const c of await shot('главная')) { checksHome++; if (c.natural===0||c.opacity===0){badHome++;bad.push(`круг ${r} ${c.where} natural=${c.natural} opacity=${c.opacity} …${c.src}`)} }

  // Заведение: кадр заведения + карточки позиций меню
  await page.locator('[data-testid^="guest-home-tile-"]').first().click()
  await page.waitForTimeout(2500)
  for (const c of await shot('заведение+меню')) {
    if (/card|full/.test(c.src)) { checksItems++; if (c.natural===0||c.opacity===0){badItems++;bad.push(`круг ${r} ${c.where} natural=${c.natural} opacity=${c.opacity} …${c.src}`)} }
    else { checksVenue++; if (c.natural===0||c.opacity===0){badVenue++;bad.push(`круг ${r} ${c.where} natural=${c.natural} opacity=${c.opacity} …${c.src}`)} }
  }
  await page.goBack()
  await page.getByTestId('guest-home').waitFor({state:'visible',timeout:30000})
}
console.log(`ширина ${width}px, кругов ${ROUNDS}`)
console.log(`  главная:        проверок ${checksHome}, пустых ${badHome}`)
console.log(`  заведение+меню: проверок ${checksItems+checksVenue}, пустых ${badItems+badVenue}`)
for (const l of bad.slice(0,10)) console.log('  ' + l)
await b.close()
