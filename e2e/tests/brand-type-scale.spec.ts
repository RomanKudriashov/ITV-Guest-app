import { type Browser, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { brandSession, guestPage } from './brandGuest'

/**
 * РАЗМЕР ТЕКСТА И МАСШТАБ ЗАГОЛОВКОВ ДОХОДЯТ ДО КАЖДОЙ БУКВЫ ГОСТЯ (партия 24).
 *
 * Витрина рисует кегли в пикселях и переводит их через `fontPx`, а метки
 * «Хит», подписи КБЖУ, строка чата, заголовок карточки, экран входа стояли в
 * `rem` или голых пикселях — ползунок их не двигал. Масштаб заголовков
 * менял 0–5 заголовков из десятков на экране.
 *
 * Замер парный, с явным условием: один и тот же экран дважды, при двух
 * значениях настройки, и каждый видимый текст (для масштаба — каждый
 * заголовок) обязан вырасти. Элемент сверяется по месту в дереве и тексту;
 * бренд возвращается к исходному.
 */

type Sizes = Record<string, { size: number; label: string; heading: boolean }>

function measure(page: Page): Promise<Sizes> {
  return page.evaluate(() => {
    const out: Record<string, { size: number; label: string; heading: boolean }> = {}
    for (const el of document.querySelectorAll('body *')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue
      const box = el.getBoundingClientRect()
      if (!box.width || !box.height) continue
      const path: string[] = []
      for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
        path.unshift(`${e.tagName}${[...(e.parentElement?.children ?? [])].indexOf(e)}`)
      }
      const text = el.textContent!.trim().slice(0, 24)
      const id = el.closest('[data-testid]')?.getAttribute('data-testid') ?? el.tagName
      out[`${path.join('/')}|${text}`] = {
        size: parseFloat(getComputedStyle(el).fontSize),
        label: `«${text}» [${id}]`,
        // Заголовок — вариант h1–h6 или тег, поставленный явно. `subtitle1/2`
        // MUI по умолчанию кладёт в <h6>: это подписи (имена блюд, разделы
        // корзины), а не заголовки, — масштаб заголовков их не касается.
        heading:
          /MuiTypography-h[1-6]/.test(String(el.className)) ||
          (/^H[1-6]$/.test(el.tagName) && !/MuiTypography-(subtitle|body|caption|overline)/.test(String(el.className))),
      }
    }
    return out
  })
}

/**
 * Бренд приходит к экрану не сразу: до ответа API тема стоит умолчанием.
 * Мерить до этого — мерить не то, поэтому ждём, пока шкала в корне станет
 * заданной.
 */
async function brandArrived(page: Page, base: number, scale: number): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = getComputedStyle(document.documentElement)
        return `${root.getPropertyValue('--type-scale').trim()}/${root.getPropertyValue('--heading-scale').trim()}`
      }),
    )
    .toBe(`${(base / 16).toFixed(4)}/${scale.toFixed(4)}`)
}

/** Экраны гостя: вход, главная, заведения, меню, карточка, корзина, чат, номер. */
async function walk(browser: Browser, base: number, scale: number): Promise<Record<string, Sizes>> {
  const screens: Record<string, Sizes> = {}
  const entry = await (await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'ru-RU' })).newPage()
  await entry.goto('/')
  await expect(entry.getByTestId('guest-room-input')).toBeVisible({ timeout: 20_000 })
  await brandArrived(entry, base, scale)
  screens['вход'] = await measure(entry)
  await entry.context().close()

  const page = await guestPage(browser)
  await brandArrived(page, base, scale)
  await expect(page.getByTestId('guest-home-tile-restaurants')).toBeVisible({ timeout: 20_000 })
  screens['главная'] = await measure(page)
  await page.goto('/category/restaurants')
  await expect(page.getByTestId('guest-venue-kitchen')).toBeVisible({ timeout: 20_000 })
  screens['заведения'] = await measure(page)
  await page.goto('/venue/kitchen')
  await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 20_000 })
  screens['меню'] = await measure(page)
  // По фото вверху карточки, а не по центру: при крупном тексте кнопка уходит
  // на вторую строку, карточка выше, и в центре оказывается строка КБЖУ.
  await page.getByTestId('guest-item-ribeye').click({ position: { x: 24, y: 24 } })
  await expect(page.getByTestId('guest-item-sheet').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('guest-item-macro').first()).toBeVisible()
  screens['карточка'] = await measure(page)
  await page.keyboard.press('Escape')
  await page.getByTestId('guest-qty-plus-caesar').click()
  await expect(page.getByTestId('guest-cart-count').first()).toHaveText('1')
  await page.getByTestId('guest-cart-button').first().click()
  await expect(page.getByTestId('guest-cart').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('guest-cart-empty')).toHaveCount(0)
  screens['корзина'] = await measure(page)
  await page.goto('/chat')
  await expect(page.getByTestId('guest-chat-composer')).toBeVisible({ timeout: 20_000 })
  screens['чат'] = await measure(page)
  await page.goto('/room')
  await expect(page.getByTestId('room-page')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('room-panel-light')).toBeVisible({ timeout: 20_000 })
  screens['номер'] = await measure(page)
  await page.context().close()
  return screens
}

/** Что не выросло между двумя замерами; и сколько вообще сверено. */
function stuck(small: Record<string, Sizes>, large: Record<string, Sizes>, headingsOnly: boolean) {
  const failures: string[] = []
  let compared = 0
  for (const [screen, before] of Object.entries(small)) {
    for (const [key, a] of Object.entries(before)) {
      const b = large[screen]?.[key]
      if (!b || (headingsOnly && !a.heading)) continue
      compared++
      if (b.size <= a.size + 0.4) failures.push(`${screen}: ${a.label} ${a.size}→${b.size}px`)
    }
  }
  return { failures, compared }
}

test('размер текста: каждый текст гостя растёт вместе с настройкой', async ({ browser, request }) => {
  test.setTimeout(300_000)
  const brand = await brandSession(request)
  try {
    await brand.apply({ typography: { fontSizeBase: 14, headingScale: 1 } })
    const small = await walk(browser, 14, 1)
    await brand.apply({ typography: { fontSizeBase: 20, headingScale: 1 } })
    const large = await walk(browser, 20, 1)
    const { failures, compared } = stuck(small, large, false)
    expect(compared, 'сверять нечего — замер пуст').toBeGreaterThan(200)
    expect(failures, 'текст гостя, который не слушает размер текста').toEqual([])
  } finally {
    await brand.restore()
  }
})

test('масштаб заголовков: каждый заголовок гостя растёт вместе с настройкой', async ({ browser, request }) => {
  test.setTimeout(300_000)
  const brand = await brandSession(request)
  try {
    await brand.apply({ typography: { fontSizeBase: 16, headingScale: 0.85 } })
    const small = await walk(browser, 16, 0.85)
    await brand.apply({ typography: { fontSizeBase: 16, headingScale: 1.4 } })
    const large = await walk(browser, 16, 1.4)
    const { failures, compared } = stuck(small, large, true)
    expect(compared, 'заголовков не нашлось — замер пуст').toBeGreaterThanOrEqual(8)
    expect(failures, 'заголовки гостя, которые не слушают масштаб').toEqual([])
  } finally {
    await brand.restore()
  }
})
