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
