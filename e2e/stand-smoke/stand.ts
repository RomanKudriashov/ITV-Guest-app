import { expect, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Адреса и учётки стенда. ДВА РАЗНЫХ ХОСТА — и это не придирка: консоль
 * платформы на стенде живёт на своём имени и отвечает `platform_wrong_host`
 * на запрос, пришедший с адреса отеля. Основной набор знает один адрес API —
 * ровно поэтому он против стенда и не идёт.
 */
export const STAND = process.env.E2E_STAND ?? 'http://localhost:5183'
export const HOTEL_BASE = process.env.E2E_STAND_HOTEL ?? STAND
export const HOTEL = process.env.E2E_HOTEL ?? 'crystal'

/** Пароли — только из окружения: в репозиторий пароли стенда не кладём. */
export const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? `owner@${HOTEL}.local`,
  password: process.env.E2E_ADMIN_PASSWORD ?? 'chef12345',
}
export const PLATFORM = {
  email: process.env.E2E_PLATFORM_EMAIL ?? '',
  password: process.env.E2E_PLATFORM_PASSWORD ?? '',
}

/** Ключи хранилища — те же, что читает приложение. */
export const KEYS = {
  cms: { access: 'itv.cms.access', refresh: 'itv.cms.refresh' },
  platform: { access: 'itv.platform.access', refresh: 'itv.platform.refresh' },
}

export async function hotelToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${HOTEL_BASE}/api/staff/auth/login`, {
    data: ADMIN,
  })
  expect(response.ok(), `вход администратора отеля: ${response.status()}`).toBeTruthy()
  return (await response.json()).access
}

export async function platformToken(request: APIRequestContext): Promise<string | null> {
  if (!PLATFORM.email || !PLATFORM.password) return null
  const response = await request.post(`${STAND}/api/platform/auth/login`, { data: PLATFORM })
  expect(response.ok(), `вход в консоль платформы: ${response.status()}`).toBeTruthy()
  return (await response.json()).access
}

/** Выход — обычное действие пользователя, а не уборка за собой. */
export async function signOut(request: APIRequestContext, token: string, base: string, path: string) {
  await request.post(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } })
}

export async function useToken(page: Page, keys: { access: string; refresh: string }, token: string) {
  await page.addInitScript(
    ([accessKey, access]) => window.localStorage.setItem(accessKey, access),
    [keys.access, token] as const,
  )
}

export async function json(
  request: APIRequestContext,
  path: string,
  token?: string,
  base = HOTEL_BASE,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await request.get(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  let body: Record<string, unknown> = {}
  try {
    body = await response.json()
  } catch {
    body = {}
  }
  return { status: response.status(), body }
}
