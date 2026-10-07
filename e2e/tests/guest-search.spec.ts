import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, DEMO_ROOM, HOTEL, apiHeaders, apiToken, removeCategory, serviceName } from './helpers'

/**
 * Глобальный поиск гостя.
 *
 * Главный сценарий здесь один и он сквозной: гость ПОМНИТ БЛЮДО, НО НЕ ПОМНИТ
 * ЗАВЕДЕНИЕ — ищет, попадает прямо в карточку и заказывает. Ради этого поиск и
 * заводился; всё остальное в файле проверяет, что он при этом не показывает
 * лишнего.
 *
 * ИЩЕТСЯ СВОЁ (партия 41, п.28). Раньше файл искал «трюф», «клубный», «сакур»
 * и «стейк» — слова из меню сида: другой сид, и поиск «ломался», хотя был цел.
 * Теперь тест заводит себе позицию в рум-сервисе с выдуманными словами — в
 * составе по-русски, в названии латиницей — и убирает её за собой. Рум-сервис
 * взят намеренно: рестораны работают по часам, и заказ из ночного прогона
 * падал бы не из-за поиска, а потому, что кухня закрыта.
 */

const TAG = Date.now().toString(36)
/** Слово из описания: его нет в названии — находится именно по составу. */
const FILLING = `кварлинг${TAG}`
/** Латинское слово названия и оно же с опечаткой — одна буква не та. */
const LATIN = 'quorvex'
const LATIN_TYPO = 'quorvax'

let dish = { code: '', categoryId: '' }

test.beforeAll(async ({ request }) => {
  const h = apiHeaders(await apiToken(request))
  const services = (await (await request.get(`${API}/api/cms/services?limit=500`, { headers: h })).json()).items as Array<{
    id: string
    code: string
  }>
  const roomService = services.find((s) => s.code === 'room_service')
  expect(roomService, 'у демо-отеля нет рум-сервиса').toBeTruthy()
  const category = await request.post(`${API}/api/cms/categories`, {
    data: { type: 'product', title: { ru: `Поиск ${TAG}` }, service_id: roomService!.id },
    headers: h,
  })
  expect(category.ok(), await category.text()).toBeTruthy()
  dish.categoryId = (await category.json()).id
  const item = await request.post(`${API}/api/cms/items`, {
    data: {
      category_id: dish.categoryId,
      type: 'product',
      title: { ru: `Пирог ${TAG}`, en: `${LATIN} pie ${TAG}` },
      description: { ru: `Тесто, ${FILLING}, сливочное масло` },
      price: 45000,
    },
    headers: h,
  })
  expect(item.ok(), await item.text()).toBeTruthy()
  dish.code = (await item.json()).code
})

test.afterAll(async ({ request }) => {
  if (dish.categoryId) await removeCategory(request, apiHeaders(await apiToken(request)), dish.categoryId)
  dish = { code: '', categoryId: '' }
})

/** Гостевой поиск прямым запросом — от лица отеля `subdomain`. */
async function apiSearch(request: APIRequestContext, subdomain: string, query: string): Promise<string[]> {
  const session = await request.post(`${API}/api/v1/guest/session`, {
    data: { language: 'ru' },
    headers: { 'X-Hotel-Subdomain': subdomain },
  })
  expect(session.ok(), await session.text()).toBeTruthy()
  const token = (await session.json()).token
  const response = await request.get(`${API}/api/v1/guest/search?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': subdomain },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const body = await response.json()
  return [...body.services, ...body.items, ...body.info].map((row: { code: string }) => row.code)
}

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
  test('ищет блюдо по слову из состава и ведёт прямо в карточку', async ({ page, request }) => {
    const venue = await serviceName(request, 'room_service')
    await enterRoom(page)
    // Начало слова, которое есть только в описании.
    await searchFor(page, FILLING.slice(0, -2))

    // Нашлось — и в выдаче сказано, ГДЕ искать: гость помнит блюдо, но не
    // помнит заведение, и это ровно то, ради чего поиск заводился.
    const row = page.getByTestId(`guest-search-result-${dish.code}`)
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('guest-search-group-items')).toBeVisible()
    await expect(row).toContainText(venue)

    // Тап ведёт ПРЯМО в карточку позиции, а не в список заведения.
    await row.click()
    await expect(page.getByTestId('guest-item-sheet')).toBeVisible({ timeout: 20_000 })
    // В адресе идентификатор позиции: витрина спрашивает карточку именно им,
    // а код она читает как испорченный UUID и падает трассировкой.
    await expect(page).toHaveURL(/\/venue\/.*item=[0-9a-f-]{36}/)
  })

  test('сквозной путь: нашёл — открыл — заказал', async ({ page }) => {
    // Своя позиция теста — в рум-сервисе, без часов работы (см. шапку файла).
    await enterRoom(page)
    await searchFor(page, FILLING)

    const row = page.getByTestId(`guest-search-result-${dish.code}`)
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

  test('ищет заведение по названию и ведёт в него', async ({ page, request }) => {
    // Начало имени кухни — из её карточки, а не из сида.
    const name = await serviceName(request, 'kitchen')
    await enterRoom(page)
    await searchFor(page, name.slice(0, 5).toLowerCase())

    const venues = page.getByTestId('guest-search-group-services')
    await expect(venues).toBeVisible({ timeout: 15_000 })
    await venues.getByTestId('guest-search-result-kitchen').click()
    await expect(page).toHaveURL(/\/venue\/kitchen/)
  })

  test('опечатка и другой язык не мешают', async ({ page }) => {
    await enterRoom(page)
    // Латиницей и с опечаткой — английское название той же позиции.
    await searchFor(page, LATIN_TYPO)
    await expect(page.getByTestId(`guest-search-result-${dish.code}`)).toBeVisible({ timeout: 15_000 })
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
    await searchFor(page, FILLING)
    await expect(page.getByTestId(`guest-search-result-${dish.code}`)).toBeVisible({ timeout: 15_000 })

    // Возвращаемся с пустым полем — запрос уже в недавних.
    await page.goto('/search')
    const recent = page.getByTestId('guest-search-recent').first()
    await expect(recent).toBeVisible({ timeout: 15_000 })
    await expect(recent).toContainText(FILLING)
    await recent.click()
    await expect(page.getByTestId('guest-search-input')).toHaveValue(FILLING)
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
    await searchFor(page, FILLING)
    await expect(page.getByTestId(`guest-search-result-${dish.code}`)).toBeVisible({ timeout: 15_000 })

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

  test('чужой отель недостижим: сессия решает, где искать', async ({ request }) => {
    /*
      УТЕЧКА — ЕДИНСТВЕННЫЙ СТРАШНЫЙ ИСХОД ЗДЕСЬ. Проверяем не через интерфейс,
      а прямым запросом: гость может подсунуть в него что угодно, и отель всё
      равно берётся из сессии, а не из параметров. Слово — своей позиции
      Кристалла: у себя она находится, из соседнего отеля — нет.
    */
    expect(await apiSearch(request, HOTEL, FILLING), 'у себя позиция находится').toContain(dish.code)
    for (const neighbour of ['azure', 'lumen']) {
      expect(await apiSearch(request, neighbour, FILLING), `позиция Кристалла в выдаче ${neighbour}`).not.toContain(dish.code)
    }
  })
})
