import { expect, type Page, type APIRequestContext } from '@playwright/test'

export const HOTEL = 'crystal'
export const API = process.env.E2E_API_URL ?? 'http://localhost:8010'
export const CREDENTIALS = { email: 'chef@crystal.local', password: 'chef12345' }

/** Уникальный суффикс, чтобы прогоны не мешали друг другу в общем демо-отеле. */
export function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`
}

export async function login(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(CREDENTIALS.email)
  await page.getByTestId('login-password').fill(CREDENTIALS.password)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/cms\/menu/)
}

/**
 * Прямой доступ к API — чтобы проверять РЕЗУЛЬТАТ действий в UI на бэкенде,
 * а не только то, что нарисовал фронт.
 */
export async function apiToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API}/api/staff/auth/login`, {
    data: CREDENTIALS,
    headers: { 'X-Hotel-Subdomain': HOTEL },
  })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).access
}

export function apiHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }
}

export async function apiGet<T>(
  request: APIRequestContext,
  token: string,
  path: string,
): Promise<T> {
  const response = await request.get(`${API}${path}`, { headers: apiHeaders(token) })
  expect(response.ok(), `GET ${path} -> ${response.status()}`).toBeTruthy()
  return (await response.json()) as T
}

export async function apiDelete(
  request: APIRequestContext,
  token: string,
  path: string,
): Promise<void> {
  await request.delete(`${API}${path}`, { headers: apiHeaders(token) })
}

export interface CmsItem {
  id: string
  code: string
  title: Record<string, string>
  price: number
  flags: string[]
  is_active: boolean
  in_stock: boolean
  category_id: string
  modifier_groups?: Array<{
    code: string
    is_required: boolean
    selection: string
    options: Array<{ code: string; price_delta: number }>
  }>
}

export async function findItemByTitle(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<CmsItem | undefined> {
  const items = await apiGet<CmsItem[]>(
    request,
    token,
    `/api/cms/items?search=${encodeURIComponent(title)}`,
  )
  // Подстрока, а не точное совпадение: у сидовых блюд название длиннее
  // искомого («Салат «Цезарь»» при поиске «Цезарь»).
  return items.find((item) => Object.values(item.title).some((value) => value.includes(title)))
}

/* ── Гостевая витрина ──────────────────────────────────────────────────── */

export const DEMO_ROOM = '305'

/** Токен персонала нужен E2E, чтобы двигать статус «от лица кухни». */
export async function moveOrderStatus(
  request: APIRequestContext,
  token: string,
  orderId: string,
  status: string,
): Promise<void> {
  const response = await request.post(`${API}/api/orders/${orderId}/status`, {
    data: { status },
    headers: apiHeaders(token),
  })
  expect(response.ok(), `смена статуса на ${status} -> ${response.status()}`).toBeTruthy()
}

export interface GuestOrder {
  id: string
  number: number
  status: { code: string; allows_guest_cancel: boolean }
  total: number
  items: Array<{ title: string; quantity: number }>
}

/** Гостевая сессия напрямую через API — для проверок мимо UI. */
export async function guestSession(
  request: APIRequestContext,
  room = DEMO_ROOM,
): Promise<string> {
  const response = await request.post(`${API}/api/guest/session`, {
    data: { room_number: room },
    headers: { 'X-Hotel-Subdomain': HOTEL },
  })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).token
}

export async function guestOrders(
  request: APIRequestContext,
  guestToken: string,
): Promise<{ active: GuestOrder[]; past: GuestOrder[] }> {
  const response = await request.get(`${API}/api/guest/orders`, {
    headers: { Authorization: `Bearer ${guestToken}`, 'X-Hotel-Subdomain': HOTEL },
  })
  expect(response.ok()).toBeTruthy()
  return response.json()
}

/* ── Заявки-услуги ─────────────────────────────────────────────────────── */

/** Консьерж обслуживает такси — отдел, отличный от кухни. */
export const CONCIERGE = { email: 'concierge@crystal.local', password: 'chef12345' }

export async function staffToken(
  request: APIRequestContext,
  credentials: { email: string; password: string },
): Promise<string> {
  const response = await request.post(`${API}/api/staff/auth/login`, {
    data: credentials,
    headers: { 'X-Hotel-Subdomain': HOTEL },
  })
  expect(response.ok(), `вход ${credentials.email} -> ${response.status()}`).toBeTruthy()
  return (await response.json()).access
}

/* ── Бренд ─────────────────────────────────────────────────────────────── */

/** Текущая тема отеля глазами гостя — для проверки «сохранил → витрина отражает». */
export async function guestTheme(request: APIRequestContext): Promise<Record<string, any>> {
  const response = await request.post(`${API}/api/guest/session`, {
    data: { room_number: DEMO_ROOM },
    headers: { 'X-Hotel-Subdomain': HOTEL },
  })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).hotel.theme
}
