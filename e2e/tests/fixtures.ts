import { test as base, expect, request as playwrightRequest } from '@playwright/test'
import type { APIRequestContext, APIResponse, Browser, BrowserContext } from '@playwright/test'

import { API } from './helpers'
import { checkBody } from '../fixtures/requestBodies'
import { E2E_HOTEL } from '../fixtures/e2eHotel'

/**
 * ОБЩАЯ ОСНОВА ПРОВЕРОК: КАЖДЫЙ ВХОД ЗАКАНЧИВАЕТСЯ ВЫХОДОМ.
 *
 * Проверки входили в систему на каждом шаге и не выходили никогда. Живой вход
 * длится неделю, и у администратора стенда их накопилось 7 936 — по 1–1,6
 * тысячи за день прогонов (пункт 32 бэклога). Настоящий человек выходит,
 * значит и проверка должна. Уборка стенда остаётся страховкой, но полагаться
 * на неё нельзя: она чинит следствие, а выход убирает причину.
 *
 * КАК ЛОВИТСЯ КАЖДЫЙ ВХОД, а не только тот, что прошёл через помощника:
 *   * запросы — через подмену `fetch` у класса контекста запросов Playwright:
 *     им пользуются и фикстура `request`, и `page.request`, и помощники;
 *   * вход через форму — по ответам страницы в КАЖДОМ контексте браузера,
 *     включая созданные самой проверкой (`browser.newContext`, `newPage`).
 *
 * КОГДА ВЫХОДИМ — при завершении воркера, а не после каждой проверки: токены
 * помощников живут между проверками (кэш входа, `beforeAll` в серийных
 * наборах), и выход сразу после первой оборвал бы сессию следующей.
 * Просроченный к этому моменту доступ обновляется по refresh — выход всё
 * равно состоится.
 */

interface Issued {
  scope: 'staff' | 'platform'
  access: string
  refresh: string
  hotel: string | null
}

const ISSUED = new Map<string, Issued>()

const LOGIN = /\/api\/(?:v1\/)?(staff|platform)\/auth\/(?:login|support-exchange)(?:\?|$)/

function header(headers: Record<string, string> | undefined, name: string): string | null {
  if (!headers) return null
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name.toLowerCase())
  return key ? headers[key] : null
}

async function remember(
  url: string,
  response: { ok(): boolean; json(): Promise<unknown> },
  hotel: string | null,
): Promise<void> {
  const match = LOGIN.exec(url)
  if (!match || !response.ok()) return
  try {
    const body = (await response.json()) as { access?: string; refresh?: string }
    if (!body?.access) return
    ISSUED.set(body.access, {
      scope: match[1] as Issued['scope'],
      access: body.access,
      refresh: body.refresh ?? '',
      hotel,
    })
  } catch {
    // Тело не JSON — входа не было, запоминать нечего.
  }
}

function watchRequests(context: APIRequestContext): void {
  const proto = Object.getPrototypeOf(context) as {
    fetch: (this: APIRequestContext, url: unknown, options?: unknown) => Promise<APIResponse>
    __logoutWatched?: boolean
  }
  if (proto.__logoutWatched) return
  const original = proto.fetch
  proto.fetch = async function watchedFetch(this: APIRequestContext, url, options) {
    const given = options as { method?: string; headers?: Record<string, string>; data?: unknown } | undefined
    const opts = given && REDIRECT ? { ...given, headers: redirectHeaders(given.headers), data: redirectBody(given.data) } : given
    options = opts
    const response = await original.call(this, url, options)
    // Считается только принятая запись: отказ 403 «не хватает роли» — проверка
    // запрета, а не правка демо-отеля.
    if (typeof url === 'string' && response.ok()) {
      guardDemo(opts?.method ?? 'GET', url, header(opts?.headers, 'X-Hotel-Subdomain'))
    }
    const target = typeof url === 'string' ? url : response.url()
    const headers = (options as { headers?: Record<string, string> } | undefined)?.headers
    await remember(target, response, header(headers, 'X-Hotel-Subdomain'))
    return response
  }
  proto.__logoutWatched = true
}

// Запросы страницы, которые несут токен сотрудника или платформы. Гостевой
// токен (`/api/guest/…`) — не сессия реестра, выходить из него не нужно.
const STAFF_CALL = /\/api\/(?:v1\/)?(?:cms|staff|tracker)\//
const PLATFORM_CALL = /\/api\/v1\/platform\//

// Нарушения контракта тел запросов (DEV-01) за время текущей проверки.
const BODY_PROBLEMS: string[] = []

/*
  ДЕМО-ОТЕЛИ В E2E — ТОЛЬКО ЧТЕНИЕ НАСТРОЕК (партия 58в).

  Дважды прерванный прогон испортил «Кристалл»: шахматка фоном бренда и °F у
  Москвы — проверка правила настройку и возвращала то, что прочитала в начале.
  Настройки отеля (бренд, главная, погода и единицы, коммерция, поиск, плитки,
  точка главного фото) e2e правит только на своём отеле `e2e-…` (`E2E_HOTEL`),
  который создаётся в начале прогона и убирается в конце. Сторож ловит запись в
  демо-отель — и запросом API, и запросом страницы — и проверка краснеет.
*/
export const DEMO_HOTELS = ['crystal', 'azure', 'lumen']
const SETTINGS_WRITE =
  /\/api\/(?:v1\/)?cms\/(?:brand(?:[/?]|$)|home-settings|commerce-settings|quick-actions|search-settings|showcase(?:[/?]|$)|media\/[^/]+\/focus)/
const DEMO_WRITES: string[] = []

/*
  ПЕРЕНАПРАВЛЕНИЕ НА СВОЙ ОТЕЛЬ (проект `own-hotel`, партия 58в). Проверки,
  правящие настройки, написаны против «Кристалла» (`HOTEL`, `owner@crystal.local`,
  панель в деве ходит в `VITE_HOTEL_SUBDOMAIN`). В проекте `own-hotel` весь их
  трафик — запросы API и запросы страниц — уходит в `E2E_HOTEL`: заголовок
  отеля и почта входа подменяются здесь, сами проверки не меняются. Отель
  прогона заведён тем же сидом: каталог, номера и имя у него те же.
*/
let REDIRECT = false
const LOGIN_EMAIL = /@crystal\.local\b/g

function redirectHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!REDIRECT || !headers) return headers
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    out[name] = name.toLowerCase() === 'x-hotel-subdomain' && value.toLowerCase() === 'crystal' ? E2E_HOTEL : value
  }
  return out
}

function redirectBody<T>(data: T): T {
  if (!REDIRECT || data == null) return data
  if (typeof data === 'string') return data.replace(LOGIN_EMAIL, `@${E2E_HOTEL}.local`) as T
  if (typeof data === 'object' && !Buffer.isBuffer(data)) {
    try {
      return JSON.parse(JSON.stringify(data).replace(LOGIN_EMAIL, `@${E2E_HOTEL}.local`)) as T
    } catch {
      return data
    }
  }
  return data
}

function guardDemo(method: string, url: string, hotel: string | null): void {
  if (method.toUpperCase() === 'GET' || !SETTINGS_WRITE.test(url)) return
  // Без заголовка отеля браузер в деве ходит в `VITE_HOTEL_SUBDOMAIN` — «Кристалл».
  const target = (hotel ?? 'crystal').toLowerCase()
  if (!DEMO_HOTELS.includes(target)) return
  const line = `${method.toUpperCase()} ${url.replace(/^https?:\/\/[^/]+/, '')} → ${target}`
  if (!DEMO_WRITES.includes(line)) DEMO_WRITES.push(line)
}

function watchContext(context: BrowserContext): void {
  const marked = context as BrowserContext & { __logoutWatched?: boolean }
  if (marked.__logoutWatched) return
  marked.__logoutWatched = true
  if (REDIRECT) {
    void context.route('**/api/**', async (route) => {
      const request = route.request()
      const headers = redirectHeaders(request.headers()) ?? request.headers()
      // Тело — только у JSON (почта входа): multipart с файлом как строку не
      // трогаем — двоичный PNG в UTF-8 бьётся, и воркер его не открывает.
      const json = (request.headers()['content-type'] ?? '').includes('application/json')
      const body = json ? request.postData() : null
      await route.fallback({ headers, ...(body ? { postData: redirectBody(body) } : {}) })
    })
    // Отель панели и витрины в dev-сборке — ключом (`api/client.ts`): тогда и
    // сокеты (`?hotel=`), которые маршрутом не перехватить, идут в отель прогона.
    void context.addInitScript((hotel) => window.localStorage.setItem('itv.dev.hotel', hotel), E2E_HOTEL)
  }
  context.on('request', (request) => {
    for (const problem of checkBody(request.method(), request.url(), request.postData())) {
      if (!BODY_PROBLEMS.includes(problem)) BODY_PROBLEMS.push(problem)
    }
  })
  context.on('response', (response) => {
    // Запись настройки демо-отеля страницей — по ПРИНЯТОМУ ответу. Запрос в
    // событии — до подмены маршрутом: в проекте `own-hotel` «Кристалл» в
    // заголовке уже ушёл в отель прогона.
    if (response.ok()) {
      const asked = response.request().headers()['x-hotel-subdomain'] ?? null
      guardDemo(
        response.request().method(),
        response.url(),
        REDIRECT && (asked ?? 'crystal') === 'crystal' ? E2E_HOTEL : asked,
      )
    }
    if (!LOGIN.test(response.url())) return
    const hotel = header(response.request().headers(), 'X-Hotel-Subdomain')
    void remember(response.url(), response, hotel)
  })
  /*
    ВТОРОЙ ПУТЬ — СИНХРОННЫЙ. Тело ответа входа читается асинхронно, и если
    проверка закрывает контекст сразу после входа, прочитать его не успевают:
    полный прогон так оставил одну сессию из 278. А токен виден в заголовке
    КАЖДОГО следующего запроса страницы — он запоминается сразу, без чтения
    тела. Обновления (refresh) у такого входа нет, но выход по доступу за
    время прогона почти всегда успевает.
  */
  context.on('request', (request) => {
    const url = request.url()
    const scope = PLATFORM_CALL.test(url) ? 'platform' : STAFF_CALL.test(url) ? 'staff' : null
    if (!scope) return
    const auth = request.headers()['authorization'] ?? ''
    const access = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!access || ISSUED.has(access)) return
    ISSUED.set(access, {
      scope,
      access,
      refresh: '',
      hotel: request.headers()['x-hotel-subdomain'] ?? null,
    })
  })
}

function watchBrowser(browser: Browser): void {
  const proto = Object.getPrototypeOf(browser) as {
    newContext: (this: Browser, options?: unknown) => Promise<BrowserContext>
    __logoutWatched?: boolean
  }
  if (proto.__logoutWatched) return
  const original = proto.newContext
  proto.newContext = async function watchedNewContext(this: Browser, options) {
    const context = await original.call(this, options)
    watchContext(context)
    return context
  }
  proto.__logoutWatched = true
}

async function logoutAll(): Promise<{ closed: number; failed: number }> {
  const api = await playwrightRequest.newContext()
  let closed = 0
  let failed = 0
  try {
    for (const entry of ISSUED.values()) {
      const base = entry.scope === 'platform' ? `${API}/api/v1/platform/auth` : `${API}/api/staff/auth`
      const headers = (access: string): Record<string, string> => ({
        Authorization: `Bearer ${access}`,
        ...(entry.hotel ? { 'X-Hotel-Subdomain': entry.hotel } : {}),
      })
      let response = await api.post(`${base}/logout`, { headers: headers(entry.access) })
      if (response.status() === 401 && entry.refresh) {
        // Доступ истёк за время прогона — сессия при этом жива, и выйти из
        // неё надо так же. Обновление даёт новый доступ ТОЙ ЖЕ сессии.
        const renewed = await api.post(`${base}/refresh`, {
          data: { refresh: entry.refresh },
          headers: entry.hotel ? { 'X-Hotel-Subdomain': entry.hotel } : {},
        })
        if (renewed.ok()) {
          const body = (await renewed.json()) as { access?: string }
          if (body.access) {
            response = await api.post(`${base}/logout`, { headers: headers(body.access) })
          }
        }
      }
      // 401 после обновления — сессию уже закрыла сама проверка (выход,
      // «выйти везде», смена пароля); 404 — отеля проверки уже нет. Это не
      // сбой выхода: сессии нет.
      if (response.ok() || response.status() === 401 || response.status() === 404) closed += 1
      else failed += 1
    }
  } finally {
    ISSUED.clear()
    await api.dispose()
  }
  return { closed, failed }
}

export const test = base.extend<
  { _requestBodies: void; _demoReadOnly: void },
  { _logoutAtEnd: void; ownHotel: boolean; _ownHotelSwitch: void }
>({
  // Проект `own-hotel` (playwright.config.ts): весь трафик — в отель прогона.
  ownHotel: [false, { option: true, scope: 'worker' }],
  _ownHotelSwitch: [
    async ({ ownHotel }, use) => {
      REDIRECT = ownHotel
      await use()
      REDIRECT = false
    },
    { scope: 'worker', auto: true },
  ],
  // Сторож демо-отелей: проверка правила настройку «Кристалла», «Азура» или
  // «Люмена» — красная с адресом. DEMO_GUARD=report — только записать в файл.
  _demoReadOnly: [
    async ({}, use, testInfo) => {
      DEMO_WRITES.length = 0
      await use()
      const found = [...DEMO_WRITES]
      DEMO_WRITES.length = 0
      if (process.env.DEMO_GUARD === 'report') {
        if (found.length) {
          const { appendFileSync } = await import('node:fs')
          appendFileSync('.demo-writes.txt', found.map((line) => `${testInfo.file.split('/').pop()}\t${line}\n`).join(''))
        }
        return
      }
      expect(found, 'проверка правит настройки демо-отеля — только на своём отеле e2e-… (E2E_HOTEL)').toEqual([])
    },
    { auto: true },
  ],
  // Сторож тел запросов: фронт прислал поле, которого ручка не знает, или не
  // прислал обязательное — проверка красная с адресом и именами полей.
  _requestBodies: [
    async ({}, use, testInfo) => {
      BODY_PROBLEMS.length = 0
      await use()
      const found = [...BODY_PROBLEMS]
      BODY_PROBLEMS.length = 0
      // BODY_GUARD=report — обход всего набора: нарушения в файл, проверка не падает.
      if (process.env.BODY_GUARD === 'report') {
        if (found.length) {
          const { appendFileSync } = await import('node:fs')
          appendFileSync('.body-report.txt', found.map((line) => `${testInfo.file.split('/').pop()}\t${line}\n`).join(''))
        }
        return
      }
      expect(found, 'фронт шлёт тело, которого не ждёт ручка (сторож контракта)').toEqual([])
    },
    { auto: true },
  ],
  _logoutAtEnd: [
    async ({ playwright, browser, _ownHotelSwitch }, use) => {
      void _ownHotelSwitch
      const probe = await playwright.request.newContext()
      watchRequests(probe)
      await probe.dispose()
      watchBrowser(browser)
      await use()
      const { closed, failed } = await logoutAll()
      if (closed || failed) {
        console.log(`[сессии] выход: закрыто ${closed}${failed ? `, не удалось ${failed}` : ''}`)
      }
    },
    { scope: 'worker', auto: true },
  ],
  // Стандартный контекст создаёт фикстура, а не проверка, — следим и за ним,
  // на случай если Playwright создал его в обход `newContext`. Переопределением,
  // а не отдельной авто-фикстурой: проверкам, которым нужен только `request`,
  // контекст браузера не нужен и создаваться не должен.
  context: async ({ context }, use) => {
    watchContext(context)
    await use(context)
  },
})

export { expect }

/**
 * Управление номером живо только у «Кристалла»: коннектор в деве один и на один
 * отель. У отеля прогона (`own-hotel`) номер честно «Нет связи», поэтому
 * проверки бренда пропускают там экран номера; сам экран номера проверяет
 * `room-control.spec.ts` на «Кристалле» — он настроек не пишет.
 */
export function roomControlLive(): boolean {
  return test.info().project.name !== 'own-hotel'
}
