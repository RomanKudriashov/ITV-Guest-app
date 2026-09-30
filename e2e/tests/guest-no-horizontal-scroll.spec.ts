import { type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, HOTEL, apiHeaders, apiToken, guestSession } from './helpers'
import { brandSession, guestPage } from './brandGuest'
import { setLanguage } from '../fixtures/appState'

/**
 * НИ ОДИН ЭКРАН ГОСТЯ НЕ ШИРЕ ТЕЛЕФОНА (партия 25).
 *
 * Страница заведения на 390 была шириной 397–517 px: сетка карточек
 * `repeat(2, 1fr)` раздвигалась под строку «цена + кнопка» (у «Сиалии» — 7 из
 * 10 заведений, у обслуживания в номере по-арабски — 473). Гость водит пальцем
 * вбок, и страница едет.
 *
 * Сторож: `scrollWidth` документа ≤ ширины окна на 390 — на каждом экране
 * гостя, каждом заведении с главной, на четырёх языках, самым широким из
 * шрифтов редактора (он ищется замером, а не по имени) и самым крупным
 * размером текста. И ни один текст не
 * обрезан краем карточки: сетка, которая не раздвигается, иначе прятала бы
 * цену вместо того, чтобы её показать. Бренд возвращается.
 */

const LANGUAGES = ['ru', 'en', 'ar', 'zh'] as const
const FIXED = ['/home', '/category/restaurants', '/cart', '/chat', '/room', '/info', '/orders', '/search']

async function venueRoutes(request: APIRequestContext): Promise<string[]> {
  const token = await guestSession(request)
  const home = await (
    await request.get(`${API}/api/v1/guest/home`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
  ).json()
  return (home.tiles as Array<{ route?: string }>)
    .map((tile) => tile.route ?? '')
    .filter((route) => route.startsWith('/venue/'))
}

test('экраны гостя на 390 не шире экрана — 4 языка, широкий шрифт', async ({ browser, request }) => {
  test.setTimeout(600_000)
  const headers = apiHeaders(await apiToken(request, ADMIN))
  const body = await (await request.get(`${API}/api/cms/brand/fonts`, { headers })).json()
  const fonts = (Array.isArray(body) ? body : body.fonts) as Array<{ family: string; name: string }>
  const venues = await venueRoutes(request)
  expect(venues.length, 'заведений на главной нет — проверять нечего').toBeGreaterThan(2)

  const brand = await brandSession(request)
  const failures: string[] = []
  try {
    const page = await guestPage(browser, { width: 390 })
    // Самый широкий шрифт — замером строки меню, а не по названию.
    const widest = await page.evaluate(async (list) => {
      const span = document.createElement('span')
      span.textContent = 'Салат с бурратой · Burrata salad 1 450 ₽'
      span.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:16px'
      document.body.appendChild(span)
      let best = list[0]
      let bestWidth = 0
      for (const font of list) {
        span.style.fontFamily = font.family
        await document.fonts.load(`16px ${font.family}`).catch(() => undefined)
        if (span.getBoundingClientRect().width > bestWidth) {
          bestWidth = span.getBoundingClientRect().width
          best = font
        }
      }
      span.remove()
      return best
    }, fonts)
    await page.context().close()
    // И самый крупный размер текста, какой отель может выбрать: сторож
    // проверяет худший допустимый случай, а не умолчание.
    await brand.apply({ typography: { fontFamily: widest.family, headingFontFamily: widest.family, fontSizeBase: 20 } })

    const guest = await guestPage(browser, { width: 390 })
    await guest.getByTestId('guest-home-tile-kitchen').waitFor()
    for (const language of LANGUAGES) {
      await setLanguage(guest, language)
      for (const route of [...FIXED, ...venues]) {
        await guest.goto(route)
        await guest.waitForLoadState('domcontentloaded')
        // Главная нарисована мимо `main` (во всю ширину), поэтому ждём не его,
        // а навигацию гостя — она есть на каждом экране оболочки.
        await expect(guest.getByTestId('guest-nav-home'), `${language} ${route}: экран не открылся`).toBeVisible({
          timeout: 20_000,
        })
        await guest.waitForTimeout(1_500)
        const { scroll, view, culprit, clipped } = await guest.evaluate(() => {
          const view = document.documentElement.clientWidth
          let culprit = ''
          for (const el of document.querySelectorAll('body *')) {
            const box = el.getBoundingClientRect()
            // Внутри полосы со своей прокруткой (вкладки категорий) — не виновник:
            // полоса обрезает содержимое сама.
            let clipped = false
            for (let e = el.parentElement; e; e = e.parentElement) {
              if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(e).overflowX)) {
                clipped = true
                break
              }
            }
            if (clipped) continue
            if (box.right > view + 1 || box.left < -1) {
              culprit = `${el.closest('[data-testid]')?.getAttribute('data-testid') ?? el.tagName} ${Math.round(box.left)}…${Math.round(box.right)}`
              break
            }
          }
          // ОБРЕЗАННЫЙ ТЕКСТ. Сетка, которая не раздвигается, прячет лишнее
          // краем карточки (`overflow: hidden`) — страница в ширину экрана, а
          // цены не видно. Текст, вылезший за край обрезающего предка, — провал;
          // намеренное многоточие (`text-overflow: ellipsis`) — нет.
          const clipped: string[] = []
          for (const el of document.querySelectorAll('body *')) {
            if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue
            const cs = getComputedStyle(el)
            if (cs.textOverflow === 'ellipsis' || cs.visibility === 'hidden') continue
            const range = document.createRange()
            range.selectNodeContents(el)
            const text = range.getBoundingClientRect()
            if (!text.width) continue
            for (let e = el.parentElement; e; e = e.parentElement) {
              const ox = getComputedStyle(e).overflowX
              if (ox === 'auto' || ox === 'scroll') break
              if (ox === 'hidden' || ox === 'clip') {
                const edge = e.getBoundingClientRect()
                if (text.right > edge.right + 1 || text.left < edge.left - 1) {
                  clipped.push(`«${el.textContent!.trim().slice(0, 20)}» [${el.closest('[data-testid]')?.getAttribute('data-testid') ?? el.tagName}]`)
                }
                break
              }
            }
          }
          return { scroll: document.documentElement.scrollWidth, view, culprit, clipped }
        })
        if (scroll > view) failures.push(`${language} ${route}: ${scroll} > ${view} (${culprit})`)
        for (const text of clipped) failures.push(`${language} ${route}: текст обрезан краем — ${text}`)
      }
    }
    await guest.context().close()
  } finally {
    await brand.restore()
  }
  expect(failures, 'экраны гостя шире телефона').toEqual([])
})
