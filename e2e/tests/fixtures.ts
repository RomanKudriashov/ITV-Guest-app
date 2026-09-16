import { test as base, expect, request as playwrightRequest } from '@playwright/test'
import type { APIRequestContext, APIResponse, Browser, BrowserContext } from '@playwright/test'

import { API } from './helpers'

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
    const response = await original.call(this, url, options)
    const target = typeof url === 'string' ? url : response.url()
    const headers = (options as { headers?: Record<string, string> } | undefined)?.headers
    await remember(target, response, header(headers, 'X-Hotel-Subdomain'))
    return response
  }
  proto.__logoutWatched = true
}

function watchContext(context: BrowserContext): void {
  const marked = context as BrowserContext & { __logoutWatched?: boolean }
  if (marked.__logoutWatched) return
  marked.__logoutWatched = true
  context.on('response', (response) => {
    if (!LOGIN.test(response.url())) return
    const hotel = header(response.request().headers(), 'X-Hotel-Subdomain')
    void remember(response.url(), response, hotel)
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

export const test = base.extend<Record<string, never>, { _logoutAtEnd: void }>({
  _logoutAtEnd: [
    async ({ playwright, browser }, use) => {
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
