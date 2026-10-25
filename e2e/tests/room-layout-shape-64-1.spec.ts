import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, DEMO_ROOM, HOTEL, waitForLayout } from './helpers'

/**
 * РАСКЛАДКА СТРАНИЦЫ НОМЕРА ПО ФОРМЕ ПЛАНА (партия 64-1).
 *
 * У «Сиалии» планы вытянуты (2.1 и 2.5): в половине ширины они становились
 * полоской 516×203. Теперь на десктопе форма берётся из пропорции кадра:
 * широкий — план во всю ширину и панели под ним; квадратный («Кристалл») — как
 * было; вертикальный — колонка поуже и план целиком в высоту экрана.
 *
 * Номер — демо «Кристалла». Другую форму даёт подменённая ПРОПОРЦИЯ в снимке:
 * раскладка зависит только от неё, и заводить ради этого отель с другим кадром
 * незачем. Телефон не меняется: там план и так во всю ширину.
 */

async function enterRoom(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-nav-room')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('guest-nav-room').click()
  await expect(page.getByTestId('room-page')).toBeVisible({ timeout: 15_000 })
}

async function roomState(request: APIRequestContext): Promise<Record<string, unknown>> {
  const session = await request.post(`${API}/api/v1/guest/session`, {
    data: { room_number: DEMO_ROOM, language: 'ru' },
    headers: { 'X-Hotel-Subdomain': HOTEL },
  })
  expect(session.ok(), 'гостевая сессия').toBeTruthy()
  const state = await request.get(`${API}/api/v1/guest/room/state`, {
    headers: { Authorization: `Bearer ${(await session.json()).token}`, 'X-Hotel-Subdomain': HOTEL },
  })
  expect(state.ok(), 'снимок номера').toBeTruthy()
  return await state.json()
}

/** Снимок с другой пропорцией плана — и REST, и канал: сокет иначе вернёт живую. */
async function withAspect(page: Page, request: APIRequestContext, aspect: number): Promise<void> {
  const snapshot = await roomState(request)
  const plan = snapshot.plan as Record<string, unknown>
  expect(plan, 'у демо-номера есть план').toBeTruthy()
  const patched = { ...snapshot, plan: { ...plan, aspect } }
  await page.routeWebSocket('**/ws/**', (ws) => ws.close())
  await page.route('**/api/v1/guest/room/state', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(patched) }),
  )
}

async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).first().boundingBox()
  expect(b, `${testId} на экране`).toBeTruthy()
  return b!
}

test.describe('Страница номера: раскладка по форме плана', () => {
  test('квадратный план («Кристалл») — как было: план слева, в своей колонке', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await enterRoom(page)
    const columns = page.getByTestId('room-two-columns')
    await expect(columns).toHaveAttribute('data-plan-shape', 'square', { timeout: 20_000 })
    await expect(page.getByTestId('room-layout-wide')).toHaveCount(0)
    await waitForLayout(page, ['room-plan'])
    const plan = await box(page, 'room-plan')
    const grid = await box(page, 'room-two-columns')
    expect(plan.width, 'план занимает левую половину, не всю ширину').toBeLessThan(grid.width * 0.55)
  })

  test('широкий план — во всю ширину, панели под ним', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await withAspect(page, request, 2.54)
    await enterRoom(page)
    await expect(page.getByTestId('room-layout-wide')).toBeVisible({ timeout: 20_000 })
    await waitForLayout(page, ['room-plan', 'room-two-columns'])
    const plan = await box(page, 'room-plan')
    const wide = await box(page, 'room-layout-wide')
    const columns = await box(page, 'room-two-columns')
    expect(plan.width, 'план во всю ширину рабочей области').toBeGreaterThan(wide.width * 0.95)
    expect(Math.round(plan.width / plan.height * 100) / 100, 'пропорция кадра сохранена').toBeCloseTo(2.54, 1)
    expect(columns.y, 'панели начинаются ПОД планом').toBeGreaterThanOrEqual(plan.y + plan.height)
    expect(plan.y + plan.height, 'план целиком в первом экране').toBeLessThanOrEqual(900)
  })

  test('вертикальный план — колонка поуже, план целиком в высоту экрана', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await withAspect(page, request, 0.4)
    await enterRoom(page)
    const columns = page.getByTestId('room-two-columns')
    await expect(columns).toHaveAttribute('data-plan-shape', 'tall', { timeout: 20_000 })
    await waitForLayout(page, ['room-plan'])
    const plan = await box(page, 'room-plan')
    expect(plan.y + plan.height, 'вертикальный план не уходит за низ экрана').toBeLessThanOrEqual(900)
    expect(Math.round(plan.width / plan.height * 100) / 100, 'кадр не обрезан — пропорция та же').toBeCloseTo(0.4, 1)
  })

  test('телефон — без изменений: широкой раскладки нет, план во всю ширину как прежде', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await withAspect(page, request, 2.54)
    await enterRoom(page)
    await waitForLayout(page, ['room-plan'])
    await expect(page.getByTestId('room-layout-wide')).toHaveCount(0)
    await expect(page.getByTestId('room-two-columns')).toHaveCount(0)
  })
})
