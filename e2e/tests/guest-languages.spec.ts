import { expect, test, type APIRequestContext } from '@playwright/test'

import { API, DEMO_ROOM, HOTEL, PLATFORM } from './helpers'

/**
 * МЕНЮ ЯЗЫКОВ У ГОСТЯ — ЯЗЫКИ ОТЕЛЯ, А НЕ ЯЗЫКИ СБОРКИ.
 *
 * Меню перебирало `SUPPORTED_LANGUAGES` — все четыре, на которые переведён
 * интерфейс. Отель, который ведёт контент на двух, всё равно предлагал гостю
 * четыре: выбрав третий, гость получал переведённый интерфейс поверх
 * непереведённого меню — блюда, описания и названия заведений на чужом языке.
 *
 * Список отеля приезжает в той же сессии, ради которой гость и пришёл
 * (`hotel.languages`), — то есть данные были, их просто не смотрели.
 */

async function platformHeaders(request: APIRequestContext) {
  const login = await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
  expect(login.ok(), await login.text()).toBeTruthy()
  return { Authorization: `Bearer ${(await login.json()).access}` }
}

async function hotelId(request: APIRequestContext, headers: Record<string, string>) {
  const hotels = await request.get(`${API}/api/v1/platform/hotels?limit=200`, { headers })
  const found = (await hotels.json()).items.find(
    (row: { subdomain: string }) => row.subdomain === HOTEL,
  )
  expect(found, `отель ${HOTEL} не найден в консоли платформы`).toBeTruthy()
  return found.id as string
}

async function setLanguages(
  request: APIRequestContext,
  headers: Record<string, string>,
  id: string,
  codes: string[],
) {
  const response = await request.patch(`${API}/api/v1/platform/hotels/${id}`, {
    data: { languages: codes },
    headers,
  })
  expect(response.status(), await response.text()).toBe(200)
}

test.describe('Гость: меню языков', () => {
  test('в меню ровно те языки, которые включил отель, и не больше', async ({ page, request }) => {
    const headers = await platformHeaders(request)
    const id = await hotelId(request, headers)

    // Исходный набор запоминаем и возвращаем в `finally`: стенд общий.
    const before = await request.get(`${API}/api/guest/hotel`, {
      headers: { 'X-Hotel-Subdomain': HOTEL },
    })
    const original = ((await before.json()).languages ?? []).map((l: { code: string }) => l.code)
    expect(original.length, 'у отеля меньше трёх языков — сужать не с чего').toBeGreaterThan(2)

    try {
      await setLanguages(request, headers, id, ['ru', 'en'])

      await page.goto('/')
      await page.evaluate(() => {
        window.localStorage.clear()
        window.sessionStorage.clear()
      })
      await page.goto('/')
      await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
      await page.getByTestId('guest-room-submit').click()
      // ЖДЁМ ВИТРИНУ, а не первую попавшуюся кнопку языка: такая же есть на
      // экране входа, и клик по ней приходится ровно на переход — экран
      // уезжает вместе с открытым меню, и проверять оказывается нечего.
      await page.waitForURL('**/home', { timeout: 20_000 })
      await expect(page.getByTestId('guest-topbar-search')).toBeVisible({ timeout: 20_000 })

      await page.getByTestId('guest-language').click()
      const items = page.locator('[data-testid^="guest-language-"]')
      await expect(items).toHaveCount(2)
      await expect(page.getByTestId('guest-language-ru')).toBeVisible()
      await expect(page.getByTestId('guest-language-en')).toBeVisible()
      // Выключенные отелем — не «спрятаны стилем», а отсутствуют.
      await expect(page.getByTestId('guest-language-ar')).toHaveCount(0)
      await expect(page.getByTestId('guest-language-zh')).toHaveCount(0)
    } finally {
      await setLanguages(request, headers, id, original)
    }
  })

  test('выбранный язык отключили — гость падает на основной язык отеля', async ({
    page,
    request,
  }) => {
    const headers = await platformHeaders(request)
    const id = await hotelId(request, headers)
    const before = await request.get(`${API}/api/guest/hotel`, {
      headers: { 'X-Hotel-Subdomain': HOTEL },
    })
    const body = await before.json()
    const original = (body.languages ?? []).map((l: { code: string }) => l.code)
    expect(original, 'для проверки нужен китайский в исходном наборе').toContain('zh')

    try {
      // Гость выбрал китайский, пока он был включён.
      await page.goto('/')
      await page.evaluate(() => window.localStorage.clear())
      await page.goto('/')
      await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
      await page.getByTestId('guest-room-submit').click()
      await page.waitForURL('**/home', { timeout: 20_000 })
      await expect(page.getByTestId('guest-topbar-search')).toBeVisible({ timeout: 20_000 })
      await page.getByTestId('guest-language').click()
      await page.getByTestId('guest-language-zh').click()
      await expect
        .poll(() => page.evaluate(() => document.documentElement.lang), { timeout: 10_000 })
        .toBe('zh')

      // Отель убирает китайский.
      await setLanguages(request, headers, id, ['ru', 'en'])
      await page.reload()
      await expect(page.getByTestId('guest-topbar-search')).toBeVisible({ timeout: 20_000 })

      // Гость оказывается на ОСНОВНОМ языке отеля, а не остаётся на убранном.
      await expect
        .poll(() => page.evaluate(() => document.documentElement.lang), { timeout: 10_000 })
        .toBe(body.default_language)
    } finally {
      await setLanguages(request, headers, id, original)
    }
  })
})
