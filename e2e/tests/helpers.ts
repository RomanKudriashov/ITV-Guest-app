import { expect, type Page, type APIRequestContext } from '@playwright/test'

export const HOTEL = 'crystal'
export const API = process.env.E2E_API_URL ?? 'http://localhost:8010'
/**
 * Повар — ЛИНЕЙНЫЙ сотрудник: трекер и операции над заказами, но не CMS.
 * С R3 раздел управления закрыт ролью, и под ним туда больше не войти.
 */
export const CREDENTIALS = { email: 'chef@crystal.local', password: 'chef12345' }

/** Админ отеля — им заводится отель (provision_hotel). Вся CMS. */
export const ADMIN = { email: 'owner@crystal.local', password: 'chef12345' }

/** Управляющий рестораном «Панорама»: своя кухня — да, чужой бар — нет. */
export const RESTAURANT_MANAGER = {
  email: 'manager.restaurant@crystal.local',
  password: 'chef12345',
}

/** Горничная — линейный персонал очереди хозслужбы. */
export const MAID = { email: 'maid@crystal.local', password: 'chef12345' }

/** Бармен — линейный персонал доски бара (туда падает заимствованный коктейль). */
export const BARMAN = { email: 'barman@crystal.local', password: 'chef12345' }

/** Уникальный суффикс, чтобы прогоны не мешали друг другу в общем демо-отеле. */
export function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`
}

/** Вход в CMS. По умолчанию админом отеля — раздел закрыт ролью (R3). */
export async function login(
  page: Page,
  credentials: { email: string; password: string } = ADMIN,
): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(credentials.email)
  await page.getByTestId('login-password').fill(credentials.password)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/cms\/menu/)
}

/** Вход в трекер: доступ даёт привязка к точке, а не роль. */
export async function loginToTracker(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(credentials.email)
  await page.getByTestId('login-password').fill(credentials.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  await page.goto('/tracker')
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })
}

/**
 * Прямой доступ к API — чтобы проверять РЕЗУЛЬТАТ действий в UI на бэкенде,
 * а не только то, что нарисовал фронт.
 */
export async function apiToken(
  request: APIRequestContext,
  credentials: { email: string; password: string } = ADMIN,
): Promise<string> {
  const response = await request.post(`${API}/api/staff/auth/login`, {
    data: credentials,
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
  allergen_ids?: string[]
  marker_ids?: string[]
  characteristics?: Array<{ name: Record<string, string>; value: Record<string, string> }>
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

/**
 * Open the cart, whatever the width. On desktop (≥1024) it is a persistent right
 * column — already visible with a non-empty order, no bar to tap. Below that it is
 * a screen reached from the floating «view cart» bar. Same `guest-cart` either way.
 */
export async function openCart(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 0;
  if (width < 1024) {
    await page.getByTestId('guest-cart-bar').click();
  }
  await expect(page.getByTestId('guest-cart')).toBeVisible({ timeout: 15_000 });
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
