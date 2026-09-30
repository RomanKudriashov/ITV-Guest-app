import { type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { expect } from './fixtures'

import { ADMIN, API, DEMO_ROOM, HOTEL, apiHeaders, apiToken } from './helpers'

/**
 * БРЕНД НА ВИТРИНЕ ГОСТЯ — ЗАМЕРОМ, С ЯВНЫМ УСЛОВИЕМ И ВОЗВРАТОМ (партия 24).
 *
 * Проверки ревизии бренда задают настройку сами (через API бренда), смотрят
 * вычисленный стиль на экране ГОСТЯ, а не в редакторе, и возвращают бренд
 * отеля ровно к тому, что было. Демо-бренд «Кристалла» ими не меняется.
 */

type Tokens = Record<string, unknown>

function deep(base: unknown, patch: unknown): unknown {
  if (Array.isArray(patch) || typeof patch !== 'object' || patch === null) return patch
  const out: Record<string, unknown> = { ...((base as Record<string, unknown>) ?? {}) }
  for (const [key, value] of Object.entries(patch)) out[key] = deep(out[key], value)
  return out
}

export interface BrandSession {
  original: Tokens
  /** Опубликовать исходные токены с наложенной правкой. */
  apply: (patch: Tokens) => Promise<void>
  /** Вернуть бренд как было и убедиться, что вернулся. */
  restore: () => Promise<void>
}

export async function brandSession(request: APIRequestContext): Promise<BrandSession> {
  const headers = apiHeaders(await apiToken(request, ADMIN))
  const original = (await (await request.get(`${API}/api/cms/brand`, { headers })).json()).tokens as Tokens
  const apply = async (patch: Tokens) => {
    const response = await request.patch(`${API}/api/cms/brand`, {
      headers,
      data: { tokens: deep(original, patch) },
    })
    expect(response.ok(), `бренд не принял правку: ${await response.text()}`).toBeTruthy()
  }
  const restore = async () => {
    // PUT заменяет всё, кроме логотипов; логотипы и пресет — отдельной правкой
    // (PATCH без пресета помечает бренд «custom»).
    await request.put(`${API}/api/cms/brand`, { headers, data: { tokens: original } })
    const brand = (original.brand ?? {}) as Record<string, unknown>
    await request.patch(`${API}/api/cms/brand`, {
      headers,
      data: {
        tokens: { preset: original.preset, brand: { logoLight: brand.logoLight ?? '', logoDark: brand.logoDark ?? '' } },
      },
    })
    const now = (await (await request.get(`${API}/api/cms/brand`, { headers })).json()).tokens
    expect(now, 'бренд отеля не вернулся к исходному').toEqual(original)
  }
  return { original, apply, restore }
}

/** Гость в номере демо-комнаты, в заданной теме и ширине. */
export async function guestPage(
  browser: Browser,
  { theme = 'light', width = 390 }: { theme?: 'light' | 'dark'; width?: number } = {},
): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ru-RU' })
  await context.addInitScript((mode) => {
    try {
      localStorage.setItem('itv.theme-mode', mode)
    } catch {
      /* private mode */
    }
  }, theme)
  const page = await context.newPage()
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
  return page
}

/** Загруженные начертания документа — не «названные», а реально загруженные. */
export function loadedFaces(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replace(/["']/g, '')),
  )
}

/** Первое семейство из вычисленного стиля элемента. */
export function firstFamily(fontFamily: string): string {
  return fontFamily.split(',')[0].replace(/["']/g, '').trim()
}

export { HOTEL }
