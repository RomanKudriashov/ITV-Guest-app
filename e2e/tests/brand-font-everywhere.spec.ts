import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { brandSession, guestPage } from './brandGuest'

/**
 * НИ ОДНОГО ТЕКСТА ГОСТЯ ЧУЖИМ ШРИФТОМ (партия 24).
 *
 * Отель выбирал шрифт — а плитки главной, метки «Хит»/«Выбор шефа», «К
 * сервисам», пилюли номера оставались Arial: голый `ButtonBase` шрифт не
 * наследует, браузер ставит кнопке свой. Проверка «на экране есть текст
 * шрифтом отеля» этого не видела — текст шрифтом отеля там был, рядом.
 *
 * Поэтому здесь обратное: условие задаётся явно (текст — Lora, заголовки —
 * Playfair Display), и КАЖДЫЙ видимый текст на экранах гостя обязан быть
 * одним из двух. Бренд возвращается к исходному.
 */

const BODY = { family: "'Lora', Georgia, serif", name: 'Lora' }
const HEAD = { family: "'Playfair Display', Georgia, serif", name: 'Playfair Display' }

async function strangers(page: Page, screen: string): Promise<string[]> {
  const found = await page.evaluate(
    (allowed) => {
      const out: string[] = []
      for (const el of document.querySelectorAll('body *')) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue
        const box = el.getBoundingClientRect()
        if (!box.width || !box.height) continue
        const family = getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim()
        if (allowed.includes(family)) continue
        const id = el.closest('[data-testid]')?.getAttribute('data-testid') ?? el.tagName
        out.push(`«${el.textContent!.trim().slice(0, 24)}» [${id}] ${family}`)
      }
      return out
    },
    [BODY.name, HEAD.name],
  )
  return found.map((line) => `${screen}: ${line}`)
}

for (const theme of ['light', 'dark'] as const) {
  test(`шрифт отеля на всех экранах гостя — ${theme}`, async ({ browser, request }) => {
    test.setTimeout(180_000)
    const brand = await brandSession(request)
    const failures: string[] = []
    try {
      await brand.apply({ typography: { fontFamily: BODY.family, headingFontFamily: HEAD.family } })
      const page = await guestPage(browser, { theme })
      failures.push(...(await strangers(page, 'главная')))

      await page.goto('/category/restaurants')
      await expect(page.getByTestId('guest-venue-kitchen')).toBeVisible({ timeout: 20_000 })
      failures.push(...(await strangers(page, 'заведения')))

      await page.goto('/venue/kitchen')
      await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 20_000 })
      failures.push(...(await strangers(page, 'меню')))

      // По фото вверху карточки: нижняя часть (КБЖУ, цена) карточку не открывает.
      await page.getByTestId('guest-item-ribeye').click({ position: { x: 24, y: 24 } })
      await expect(page.getByTestId('guest-item-sheet').first()).toBeVisible({ timeout: 15_000 })
      failures.push(...(await strangers(page, 'карточка')))
      await page.keyboard.press('Escape')

      await page.getByTestId('guest-qty-plus-caesar').click()
      await page.goto('/cart')
      await expect(page.getByTestId('guest-cart')).toBeVisible({ timeout: 20_000 })
      failures.push(...(await strangers(page, 'корзина')))

      await page.goto('/chat')
      await expect(page.getByTestId('guest-chat-composer')).toBeVisible({ timeout: 20_000 })
      failures.push(...(await strangers(page, 'чат')))

      await page.goto('/room')
      await expect(page.getByTestId('room-page')).toBeVisible({ timeout: 20_000 })
      failures.push(...(await strangers(page, 'номер')))
      await page.context().close()
    } finally {
      await brand.restore()
    }
    expect(failures, 'текст гостя не шрифтом отеля').toEqual([])
  })
}
