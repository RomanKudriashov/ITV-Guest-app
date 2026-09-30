import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken } from './helpers'
import { brandSession, guestPage } from './brandGuest'

/**
 * СВОЙ ШРИФТ В TTF/OTF ГРУЗИТСЯ У ГОСТЯ (партия 25).
 *
 * `@font-face` писал `format('ttf')`/`format('otf')` — таких значений у CSS
 * нет, и браузер молча пропускал источник: отель, принёсший шрифт из
 * брендбука в TTF или OTF, видел запасной. Сервер теперь отдаёт
 * `truetype`/`opentype`, а тема переводит и старые значения — у отелей,
 * загрузивших шрифт раньше, он заработает без правки их токенов.
 *
 * Файл — настоящий TrueType (наш же Manrope, распакованный из woff2), а замер —
 * начертание в статусе `loaded` на витрине гостя, не в редакторе.
 */

const TTF = readFileSync(join(__dirname, '../fixtures/manrope-400-cyrillic.ttf'))

async function uploadFont(request: APIRequestContext, name: string) {
  const headers = apiHeaders(await apiToken(request, ADMIN))
  const response = await request.post(`${API}/api/cms/brand/font`, {
    headers,
    multipart: { file: { name, mimeType: 'font/ttf', buffer: TTF } },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()) as { assetId: string; name: string; family: string; url: string; format: string }
}

for (const [label, legacy] of [
  ['новая загрузка', false],
  ['токены, записанные до исправления (format: ttf)', true],
] as const) {
  test(`TTF-шрифт отеля загружен у гостя — ${label}`, async ({ browser, request }) => {
    test.setTimeout(120_000)
    const brand = await brandSession(request)
    try {
      const font = await uploadFont(request, legacy ? 'Старый Гротеск.ttf' : 'Новый Гротеск.ttf')
      expect(font.format, 'сервер отдал не значение CSS').toBe('truetype')
      await brand.apply({
        brand: { customFont: { ...font, format: legacy ? 'ttf' : font.format } },
        typography: { fontFamily: font.family },
      })

      const page = await guestPage(browser)
      await expect
        .poll(
          () =>
            page.evaluate(
              (name) =>
                [...document.fonts].some(
                  (face) => face.family.replace(/["']/g, '') === name && face.status === 'loaded',
                ),
              font.name,
            ),
          { timeout: 15_000, message: 'шрифт отеля назван в теме, но браузер его не загрузил' },
        )
        .toBe(true)
      await page.context().close()
    } finally {
      await brand.restore()
    }
  })
}
