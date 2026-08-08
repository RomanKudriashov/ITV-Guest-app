import { expect, test, type Page } from '@playwright/test'

import { API, DEMO_ROOM, HOTEL } from './helpers'

/**
 * Глобальный поиск гостя.
 *
 * Главный сценарий здесь один и он сквозной: гость ПОМНИТ БЛЮДО, НО НЕ ПОМНИТ
 * ЗАВЕДЕНИЕ — ищет, попадает прямо в карточку и заказывает. Ради этого поиск и
 * заводился; всё остальное в файле проверяет, что он при этом не показывает
 * лишнего.
 */

async function enterRoom(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
}

async function searchFor(page: Page, query: string): Promise<void> {
  await page.goto(`/search?q=${encodeURIComponent(query)}`)
  await expect(page.getByTestId('guest-search')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('guest-search-input')).toHaveValue(query)
}

test.describe('Поиск гостя', () => {
  test('ищет блюдо по слову из состава и ведёт прямо в карточку', async ({ page }) => {
    await enterRoom(page)
    await searchFor(page, 'трюф')

    // Нашлось — и в выдаче сказано, ГДЕ искать: гость помнит блюдо, но не
    // помнит заведение, и это ровно то, ради чего поиск заводился.
    const results = page.locator('[data-testid^="guest-search-result-"]')
    await expect(results.first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('guest-search-group-items')).toBeVisible()
    await expect(results.first()).toContainText(/Терраса|Панорама|Сакура/)

    // Тап ведёт ПРЯМО в карточку позиции, а не в список заведения.
    await results.first().click()
    await expect(page.getByTestId('guest-item-sheet')).toBeVisible({ timeout: 20_000 })
    // В адресе идентификатор позиции: витрина спрашивает карточку именно им,
    // а код она читает как испорченный UUID и падает трассировкой.
    await expect(page).toHaveURL(/\/venue\/.*item=[0-9a-f-]{36}/)
  })

  test('сквозной путь: нашёл — открыл — заказал', async ({ page }) => {
    /*
      Блюдо берётся из РУМ-СЕРВИСА намеренно. Рестораны работают по часам, и
      тест, ищущий ризотто «Террасы», проходил бы с полудня до полуночи и падал
      ночью — не потому, что поиск сломан, а потому, что кухня закрыта. Ночной
      прогон не должен объяснять человеку разницу.
    */
    await enterRoom(page)
    await searchFor(page, 'клубный')

    const row = page.locator('[data-testid^="guest-search-result-"]').first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.click()

    await expect(page.getByTestId('guest-item-sheet')).toBeVisible({ timeout: 20_000 })
    const add = page.getByTestId('guest-add-to-cart')
    await expect(add).toBeVisible({ timeout: 15_000 })
    await add.click()

    // Заказ собрался: позиция уехала в корзину, а не «нашлось и ладно».
    await expect(
      page.getByTestId('guest-cart-bar').or(page.getByTestId('guest-topbar-cart')),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('ищет заведение по названию и ведёт в него', async ({ page }) => {
    await enterRoom(page)
    await searchFor(page, 'сакур')

    const venues = page.getByTestId('guest-search-group-services')
    await expect(venues).toBeVisible({ timeout: 15_000 })
    await venues.locator('[data-testid^="guest-search-result-"]').first().click()
    await expect(page).toHaveURL(/\/venue\//)
  })

  test('опечатка и другой язык не мешают', async ({ page }) => {
    await enterRoom(page)
    // Латиницей и с опечаткой — про блюдо, названное по-русски.
    await searchFor(page, 'trufle')
    await expect(page.locator('[data-testid^="guest-search-result-"]').first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test('ничего не нашлось — это ответ, а не пустая страница', async ({ page }) => {
    await enterRoom(page)
    await searchFor(page, 'квадрокоптер')

    const empty = page.getByTestId('guest-search-empty')
    await expect(empty).toBeVisible({ timeout: 15_000 })
    // Гостю сказано, что делать дальше, и дана дорога к живому человеку.
    await expect(page.getByTestId('guest-search-ask')).toBeVisible()
    await page.getByTestId('guest-search-ask').click()
    await expect(page).toHaveURL(/\/chat/)
  })

  test('недавние запросы остаются на устройстве и подставляются в поле', async ({ page }) => {
    await enterRoom(page)
    await searchFor(page, 'стейк')
    await expect(page.locator('[data-testid^="guest-search-result-"]').first()).toBeVisible({
      timeout: 15_000,
    })

    // Возвращаемся с пустым полем — запрос уже в недавних.
    await page.goto('/search')
    const recent = page.getByTestId('guest-search-recent').first()
    await expect(recent).toBeVisible({ timeout: 15_000 })
    await expect(recent).toContainText('стейк')
    await recent.click()
    await expect(page.getByTestId('guest-search-input')).toHaveValue('стейк')
  })

  test('точка входа есть на телефоне и на десктопе', async ({ page }) => {
    await enterRoom(page)
    // Десктоп: значок в верхней строке.
    await expect(page.getByTestId('guest-topbar-search')).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
    // Телефон: вкладка нижней навигации.
    await page.getByTestId('guest-nav-search').click()
    await expect(page.getByTestId('guest-search')).toBeVisible({ timeout: 15_000 })
  })

  test('липкое поле не накрывает выдачу — слой ОБЩЕГО стека, а не свой', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await enterRoom(page)
    await searchFor(page, 'трюф')
    await expect(page.locator('[data-testid^="guest-search-result-"]').first()).toBeVisible({
      timeout: 15_000,
    })

    /*
      Прежняя поломка выглядела так: поле прилипало ВЫШЕ своего места в потоке
      и накрывало заголовок группы. Проверяем то же, что видит глаз: кто лежит
      в точке первой строки выдачи.
    */
    const row = page.locator('[data-testid^="guest-search-result-"]').first()
    const box = (await row.boundingBox())!
    const under = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
      [box.x + box.width / 2, box.y + box.height / 2],
    )
    expect(under, 'первую строку выдачи что-то накрывает').toMatch(/^guest-search-result-/)
  })

  test('чужой отель недостижим: сессия решает, где искать', async ({ page, request }) => {
    /*
      УТЕЧКА — ЕДИНСТВЕННЫЙ СТРАШНЫЙ ИСХОД ЗДЕСЬ. Проверяем не через интерфейс,
      а прямым запросом: гость может подсунуть в него что угодно, и отель всё
      равно берётся из сессии, а не из параметров.
    */
    const session = await request.post(`${API}/api/v1/guest/session`, {
      data: { room_number: DEMO_ROOM, language: 'ru' },
      headers: { 'X-Hotel-Subdomain': HOTEL },
    })
    expect(session.ok()).toBeTruthy()
    const token = (await session.json()).token

    const response = await request.get(`${API}/api/v1/guest/search?q=%D0%B0%D0%B2%D1%80%D0%BE%D1%80`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    const foreign = [...body.services, ...body.items, ...body.info].filter((row: { title: string }) =>
      /аврор/i.test(row.title),
    )
    expect(foreign, `в выдачу попал чужой отель: ${JSON.stringify(foreign)}`).toEqual([])
  })
})
