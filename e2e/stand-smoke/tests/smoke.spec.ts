import { expect, test, type Page } from '@playwright/test'

import {
  HOTEL,
  HOTEL_BASE,
  KEYS,
  PLATFORM,
  STAND,
  hotelToken,
  json,
  platformToken,
  signOut,
  useToken,
} from '../stand'

/**
 * СМОК СТЕНДА: экраны открываются, ручки отвечают, гость жив.
 *
 * Гоняется ПОСЛЕ КАЖДОЙ ВЫКАТКИ, снаружи — и этим дополняет `check_demo_stand`,
 * который смотрит изнутри контейнера и про nginx, TLS и маршрутизацию по
 * хостам не знает ничего.
 *
 * Набор НИЧЕГО НЕ ПИШЕТ. Ровно два следа — вход сотрудника и гостевая сессия,
 * то же самое, что оставляет человек, открывший панель и витрину; из входа
 * набор выходит сам. Проверка, которой понадобилась бы запись, сюда не
 * попадает: приделать к показному стенду уборку — значит однажды убрать
 * чужое.
 */

/** Арабица и китайские иероглифы. Латиница разрешена: коды, бренды, единицы. */
const FOREIGN = /[؀-ۿ一-鿿]/

let admin = ''
let platform: string | null = null

test.beforeAll(async ({ request }) => {
  admin = await hotelToken(request)
  platform = await platformToken(request)
})

test.afterAll(async ({ request }) => {
  // Выход — обычное действие пользователя. Уборкой это не является и ничего,
  // кроме своего входа, не трогает.
  if (admin) await signOut(request, admin, HOTEL_BASE, '/api/staff/auth/logout')
  if (platform) await signOut(request, platform, STAND, '/api/platform/auth/logout')
  console.log(`[смок] стенд ${STAND}, отель ${HOTEL} — записей не делалось`)
})

/* ── Ручки ─────────────────────────────────────────────────────────────── */

test('ключевые ручки отеля отвечают', async ({ request }) => {
  const checks: Array<[string, string]> = [
    ['/api/cms/dashboard', 'пульт отеля'],
    ['/api/cms/navigation', 'меню CMS'],
    ['/api/cms/bootstrap', 'справочники CMS'],
    ['/api/cms/reviews?limit=5', 'отзывы'],
    ['/api/cms/reviews/summary', 'сводка отзывов'],
    ['/api/cms/notification-log?limit=5', 'журнал отправок'],
    ['/api/cms/notification-events?limit=5', 'журнал событий'],
    ['/api/tracker/orders?point=kitchen', 'доска трекера'],
  ]
  const broken: string[] = []
  for (const [path, label] of checks) {
    const { status } = await json(request, path, admin)
    if (status !== 200) broken.push(`${label} (${path}) → ${status}`)
  }
  expect(broken, `ручки не ответили:\n${broken.join('\n')}`).toEqual([])
})

test('аналитика считает за период, а не только за сегодня', async ({ request }) => {
  // Умолчание окна — неделя. На показе смотрят период, и пустой ответ за
  // неделю ещё не значит, что аналитика сломана.
  const today = new Date()
  const from = new Date(today.getTime() - 60 * 24 * 3600_000).toISOString().slice(0, 10)
  const to = today.toISOString().slice(0, 10)
  const { status, body } = await json(
    request,
    `/api/cms/analytics/summary?date_from=${from}&date_to=${to}`,
    admin,
  )
  expect(status).toBe(200)
  const current = (body.current ?? {}) as { orders?: number }
  expect(current.orders ?? 0, 'за два месяца на стенде нет ни одного заказа').toBeGreaterThan(0)
})

/* ── Гость ─────────────────────────────────────────────────────────────── */

test('гость жив: сессия, главная, каталог, места, баннер', async ({ request }) => {
  const created = await request.post(`${HOTEL_BASE}/api/guest/session`, {
    data: { room_number: process.env.E2E_ROOM ?? '305', language: 'ru' },
  })
  expect(created.ok(), `гостевая сессия: ${created.status()}`).toBeTruthy()
  const token = (await created.json()).token as string

  const home = await json(request, '/api/guest/home', token)
  expect(home.status).toBe(200)
  expect((home.body.tiles as unknown[]).length, 'витрина без плиток').toBeGreaterThan(0)

  const catalog = await json(request, '/api/guest/catalog?type=product', token)
  expect(catalog.status).toBe(200)
  expect((catalog.body.categories as unknown[]).length, 'каталог пуст').toBeGreaterThan(0)

  const places = await json(request, '/api/guest/locations', token)
  expect(places.status).toBe(200)
  expect((places.body.locations as unknown[]).length, 'нет мест получения').toBeGreaterThan(0)

  // Баннер — отдельной ручкой, и «ничего» здесь законный ответ: проверяем, что
  // ручка жива, а не что реклама заведена.
  const banner = await json(request, '/api/guest/banner', token)
  expect(banner.status).toBe(200)
})

test('погода отдаётся числом', async ({ request }) => {
  const created = await request.post(`${HOTEL_BASE}/api/guest/session`, {
    data: { room_number: process.env.E2E_ROOM ?? '305', language: 'ru' },
  })
  const token = (await created.json()).token as string
  // Первый запрос греет кэш: обновление ставит первый гость, увидевший
  // протухшее значение. Второй обязан прийти с числом.
  await json(request, '/api/guest/home', token)
  const { body } = await json(request, '/api/guest/home', token)
  const weather = body.weather as { temperature?: number } | null
  expect(weather, 'погоды нет: город не выбран или воркер не обновляет').not.toBeNull()
  expect(typeof weather?.temperature).toBe('number')
})

/* ── Экраны ────────────────────────────────────────────────────────────── */

async function openCms(page: Page) {
  await useToken(page, KEYS.cms, admin)
  await page.goto(`${HOTEL_BASE}/cms/dashboard`)
  await expect(page.getByTestId('cms-page-title')).toBeVisible({ timeout: 25_000 })
}

/** Разделы берём ИЗ МЕНЮ, которое отдал сервер: список в тесте отстанет. */
async function sections(page: Page) {
  const links = page.locator('[data-testid^="cms-nav-"]')
  await expect(links.first()).toBeVisible({ timeout: 25_000 })
  const out: Array<{ key: string; label: string; href: string }> = []
  for (const link of await links.all()) {
    const key = ((await link.getAttribute('data-testid')) ?? '').replace('cms-nav-', '')
    if (key === 'tracker' || key === 'desk') continue
    out.push({
      key,
      label: (await link.innerText()).trim(),
      href: (await link.getAttribute('href')) ?? '',
    })
  }
  return out
}

test('все разделы CMS открываются, заголовок совпадает с пунктом меню', async ({ page }) => {
  await openCms(page)
  const items = await sections(page)
  expect(items.length, 'меню пусто').toBeGreaterThan(5)

  const mismatched: string[] = []
  for (const item of items) {
    await page.goto(`${HOTEL_BASE}${item.href}`)
    const title = page.getByTestId('cms-page-title')
    await expect(title, `раздел «${item.label}» не открылся`).toBeVisible({ timeout: 25_000 })
    const text = (await title.innerText()).trim()
    if (text !== item.label) mismatched.push(`«${item.label}» → страница «${text}»`)
  }
  expect(mismatched, `заголовок не совпал с пунктом меню:\n${mismatched.join('\n')}`).toEqual([])
})

test('в русском интерфейсе нет чужого алфавита', async ({ page }) => {
  await openCms(page)
  const items = await sections(page)
  const dirty: string[] = []
  for (const item of items) {
    await page.goto(`${HOTEL_BASE}${item.href}`)
    await expect(page.getByTestId('cms-page-title')).toBeVisible({ timeout: 25_000 })
    const text = await page.locator('body').innerText()
    const hit = text.match(FOREIGN)
    if (hit) {
      const at = text.indexOf(hit[0])
      dirty.push(`${item.label}: …${text.slice(Math.max(0, at - 40), at + 20).replace(/\n/g, ' ')}…`)
    }
  }
  expect(dirty, `чужой алфавит в русском интерфейсе:\n${dirty.join('\n')}`).toEqual([])
})

test('трекер открывается в общей оболочке и с меню', async ({ page }) => {
  await useToken(page, KEYS.cms, admin)
  await page.goto(`${HOTEL_BASE}/tracker`)
  await expect(page.getByTestId('tracker-board'), 'доска трекера не нарисовалась').toBeVisible({
    timeout: 25_000,
  })
  await expect(
    page.locator('[data-testid^="cms-nav-"]').first(),
    'трекер без общего меню — значит вне оболочки',
  ).toBeVisible({ timeout: 25_000 })
})

test('витрины всех отелей стенда открываются', async ({ page }) => {
  /*
    Вход ШТАТНЫМ ПУТЁМ «смотреть без номера», а не подкладыванием токена.

    Номера у отелей разные («305» у Кристалла, «101» у Азура, «01» у Люмена),
    и набор, помнящий их наизусть, сломается на первом же новом отеле стенда —
    то есть покраснеет на своей памяти, а не на поломке. Режим просмотра
    открывает витрину у любого отеля, и это настоящая дорога гостя, а не
    обходная: смотреть можно всё, заказать нечего и некуда.
  */
  const hotels = (process.env.E2E_HOTELS ?? `${HOTEL},azure,lumen`).split(',')
  const broken: string[] = []
  for (const raw of hotels) {
    const code = raw.trim()
    const base = HOTEL_BASE.replace(`://${HOTEL}.`, `://${code}.`)
    await page.goto(`${base}/`)
    await page.evaluate(() => {
      window.localStorage.clear()
      window.sessionStorage.clear()
    })
    await page.goto(`${base}/`)
    /*
      Ждём ОЖИДАНИЕМ, а не `isVisible`. Тот отвечает мгновенно и таймаут
      игнорирует: на своей машине экран успевает нарисоваться и проверка
      «работает», а против стенда через сеть — краснеет на пустом месте.
      Поймано здесь же, на первом прогоне.
    */
    const browse = page.getByTestId('guest-browse-only')
    const opened = await browse
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false)
    if (!opened) {
      broken.push(`${code}: экран входа не открылся`)
      continue
    }
    await browse.click()
    // Якорь — `guest-home`, а не плитки: у отеля без наполнения плиток может
    // не быть вовсе, и это не повод краснеть смоку.
    const home = page.getByTestId('guest-home')
    const drawn = await home
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false)
    if (!drawn) broken.push(`${code}: витрина не нарисовалась`)
  }
  expect(broken, `витрины не открылись:\n${broken.join('\n')}`).toEqual([])
})

test('консоль платформы открывается', async ({ page, request }) => {
  test.skip(!PLATFORM.email, 'пароль платформы не задан — консоль не проверяется')
  const token = await platformToken(request)
  await useToken(page, KEYS.platform, token as string)
  await page.goto(`${STAND}/admin`)
  await expect(page.getByTestId('admin-shell').or(page.getByTestId('cms-page-title'))).toBeVisible({
    timeout: 30_000,
  })
  await signOut(request, token as string, STAND, '/api/platform/auth/logout')
})
