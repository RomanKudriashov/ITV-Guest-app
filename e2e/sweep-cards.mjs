import { chromium } from '@playwright/test'

/**
 * ПРОХОД ПО ВСЕМ КАРТОЧКАМ ТРЁХ ОТЕЛЕЙ.
 *
 * Карточка читается из данных, а наборы полей у отелей разные: у «Кристалла»
 * есть КБЖУ и добавки, у «Азура» половина позиций без КБЖУ, у «Люмена» их нет
 * почти нигде. Ломается обычно та карточка, которую не смотрели, — поэтому
 * открываем КАЖДУЮ и проверяем машинно: горизонтального переполнения нет,
 * пустых подписей нет, кнопка заказа на месте.
 *
 * Витрина знает свой отель из переменной сборки, поэтому на каждый отель — свой
 * адрес: 5183 (crystal, контейнер), 5191 (azure), 5192 (lumen).
 */
const STANDS = [
  { hotel: 'crystal', room: '305', base: 'http://localhost:5183', venue: 'kitchen' },
  { hotel: 'azure', room: '101', base: 'http://127.0.0.1:5191', venue: 'laguna-bar' },
  { hotel: 'lumen', room: '01', base: 'http://127.0.0.1:5192', venue: 'bistro' },
]
const API = 'http://localhost:8010/api/v1'
const browser = await chromium.launch()
const api = await browser.newContext()
let problems = 0

for (const stand of STANDS) {
  const session = await api.request.post(`${API}/guest/session`, {
    data: { room_number: stand.room, language: 'ru' },
    headers: { 'X-Hotel-Subdomain': stand.hotel },
  })
  const token = (await session.json()).token
  const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': stand.hotel }
  const menu = await (await api.request.get(`${API}/guest/catalog`, { headers })).json()
  const items = (menu.categories ?? []).flatMap((c) => c.items ?? [])

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' })
  const page = await ctx.newPage()
  await page.goto(stand.base)
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.goto(stand.base)
  await page.getByTestId('guest-room-input').fill(stand.room)
  await page.getByTestId('guest-room-submit').click()
  await page.getByTestId('guest-home').waitFor({ timeout: 25000 })

  let checked = 0
  for (const item of items) {
    await page.goto(`${stand.base}/venue/${stand.venue}?item=${item.id}`)
    try {
      await page.getByTestId('guest-item-sheet').waitFor({ timeout: 12000 })
    } catch {
      console.log(`  ✗ ${stand.hotel}/${item.code}: карточка не открылась`)
      problems += 1
      continue
    }
    await page.waitForTimeout(250)
    const verdict = await page.evaluate(() => {
      const sheet = document.querySelector('[data-testid="guest-item-sheet"]')
      if (!sheet) return { fail: 'нет шторки' }
      // Пустая подпись блока: заголовок есть, а под ним ничего.
      const captions = ['Состав', 'Содержит', 'Подходит']
      const empty = []
      for (const caption of captions) {
        const node = [...sheet.querySelectorAll('*')].find(
          (el) => el.children.length === 0 && el.textContent.trim() === caption,
        )
        if (!node) continue
        const block = node.parentElement
        if (!block || block.textContent.trim() === caption) empty.push(caption)
      }
      // Переполнение по горизонтали — кроме кадра, он намеренно шире полей.
      const over = []
      for (const el of sheet.querySelectorAll('div,span,p,h2,button')) {
        if (el.querySelector('img')) continue
        if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'visible') {
          over.push((el.getAttribute('data-testid') || el.tagName) + `:${el.scrollWidth}>${el.clientWidth}`)
        }
      }
      return { empty, over: over.slice(0, 3) }
    })
    const cta = await page.getByTestId('guest-add-to-cart').count()
    const problem = verdict.fail || verdict.empty?.length || verdict.over?.length
    if (problem) {
      console.log(`  ✗ ${stand.hotel}/${item.code}:`, JSON.stringify(verdict))
      problems += 1
    }
    if (!cta && !verdict.fail) {
      // Не у каждой позиции есть кнопка корзины (заявка шлётся, а не кладётся).
      const send = await page.getByTestId('guest-request-submit').count()
      if (!send) { console.log(`  ✗ ${stand.hotel}/${item.code}: нет действия в подвале`); problems += 1 }
    }
    checked += 1
  }
  console.log(`${stand.hotel}: проверено карточек ${checked}`)
  await ctx.close()
}

console.log(problems ? `НАЙДЕНО ПРОБЛЕМ: ${problems}` : 'проблем нет')
await browser.close()
