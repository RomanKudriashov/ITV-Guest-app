import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, DEMO_ROOM, HOTEL, PLATFORM, apiToken, signInToCms } from './helpers'

/**
 * ВКЛАДКА «СОБЫТИЯ»: ЧТО СИСТЕМА СООБЩАЕТ И КАК ЭТО ПРИДЁТ.
 *
 * Главное здесь — превью. Урок оформления (партия 7): превью было наполовину
 * выдумано, и человек не мог отличить выдуманное от настоящего. Поэтому
 * проверяется, что пример — НАСТОЯЩИЙ случай отеля (заявка, которую тест сам
 * создал и отменил), что черновик текста виден в нём до сохранения и что
 * превью ничего не сохраняет.
 *
 * Стенд общий: настройки событий тест ставит явно и возвращает как было —
 * проверка, которая читает состояние стенда, сама им становится.
 */

const CODES = [
  'order.overdue',
  'order.cancelled',
  'chat.guest_message',
  'review.low',
  'brand.published_on_schedule',
  'brand.published_late',
  'brand.schedule_failed',
  'notification.undelivered',
]
const ACTIONABLE = new Set(['order.overdue', 'order.cancelled', 'review.low', 'notification.undelivered'])

interface SettingItem {
  code: string
  audience: string
  enabled_by_default: boolean
  audience_from_rules: boolean
  setting: {
    enabled: boolean
    customized: boolean
    audience: string
    channel_id: string | null
    channel_types: string[]
    templates: Record<string, { subject: string; body: string }>
  }
}

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }
}

async function settings(request: APIRequestContext, token: string): Promise<SettingItem[]> {
  const response = await request.get(`${API}/api/cms/notification-events/settings`, {
    headers: headers(token),
  })
  expect(response.status(), await response.text()).toBe(200)
  return (await response.json()).items
}

async function put(
  request: APIRequestContext,
  token: string,
  code: string,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await request.put(`${API}/api/cms/notification-events/settings/${code}`, {
    data: body,
    headers: headers(token),
  })
  expect(response.status(), await response.text()).toBe(200)
}

/** Как по умолчанию: строка настройки отеля удаляется, событие снова следует справочнику. */
async function resetAll(request: APIRequestContext, token: string): Promise<void> {
  for (const item of await settings(request, token)) {
    const body: Record<string, unknown> = { enabled: item.enabled_by_default, templates: {} }
    if (!item.audience_from_rules) {
      Object.assign(body, { audience: item.audience, channel_types: [], channel_id: null })
    }
    await put(request, token, item.code, body)
  }
}

/**
 * Вернуть стенд КАК БЫЛ, а не «как по умолчанию»: у демо-отеля свои решения
 * (сообщения гостя в чат включены его настройкой), и тест не вправе их стирать.
 */
async function restore(
  request: APIRequestContext,
  token: string,
  saved: SettingItem[],
): Promise<void> {
  await resetAll(request, token)
  for (const item of saved.filter((entry) => entry.setting.customized)) {
    const { enabled, audience, channel_id, channel_types, templates } = item.setting
    await put(
      request,
      token,
      item.code,
      item.audience_from_rules
        ? { enabled, templates }
        : { enabled, audience, channel_id, channel_types, templates },
    )
  }
}

function findByCode(node: unknown, code: string): { id: string } | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findByCode(entry, code)
      if (found) return found
    }
    return null
  }
  const record = node as Record<string, unknown>
  if (record.code === code && typeof record.id === 'string') return record as { id: string }
  for (const value of Object.values(record)) {
    const found = findByCode(value, code)
    if (found) return found
  }
  return null
}

async function placeOrder(
  request: APIRequestContext,
): Promise<{ id: string; number: number; guest: string }> {
  const session = await request.post(`${API}/api/guest/session`, {
    data: { room_number: DEMO_ROOM },
    headers: { 'X-Hotel-Subdomain': HOTEL },
  })
  expect(session.ok(), 'гостевая сессия не открылась').toBeTruthy()
  const guest = (await session.json()).token
  const guestHeaders = { Authorization: `Bearer ${guest}`, 'X-Hotel-Subdomain': HOTEL }

  const catalog = await request.get(`${API}/api/guest/catalog`, { headers: guestHeaders })
  const caesar = findByCode(await catalog.json(), 'caesar')
  expect(caesar, 'в каталоге демо-отеля не нашлось «Цезаря»').toBeTruthy()

  const created = await request.post(`${API}/api/guest/order`, {
    data: { lines: [{ item_id: (caesar as { id: string }).id, quantity: 1 }] },
    headers: {
      ...guestHeaders,
      'Idempotency-Key': `e2e-events-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  })
  expect(created.ok(), `заказ не создался -> ${created.status()}`).toBeTruthy()
  const order = await created.json()
  return { id: order.id, number: order.number, guest }
}

async function cancelAsGuest(
  request: APIRequestContext,
  order: { id: string; guest: string },
): Promise<void> {
  const response = await request.post(`${API}/api/guest/order/${order.id}/cancel`, {
    data: { reason: '' },
    headers: { Authorization: `Bearer ${order.guest}`, 'X-Hotel-Subdomain': HOTEL },
  })
  expect(response.ok(), `гость не смог отменить -> ${response.status()}`).toBeTruthy()
}

async function openEvents(page: Page): Promise<void> {
  await signInToCms(page)
  await page.goto('/cms/notifications')
  await page.getByTestId('cms-notifications-tab-events').click()
  await expect(page.getByTestId('cms-notification-events')).toBeVisible({ timeout: 20_000 })
}

test.describe('Уведомления: события', () => {
  test.describe.configure({ mode: 'serial' })

  let token = ''
  let saved: SettingItem[] = []

  test.beforeAll(async ({ request }) => {
    token = await apiToken(request)
    saved = await settings(request, token)
    await resetAll(request, token)
  })

  test.afterAll(async ({ request }) => {
    await restore(request, token || (await apiToken(request)), saved)
  })

  test('по умолчанию включено только то, что требует действия', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await openEvents(page)

    for (const code of CODES) {
      const state = page.getByTestId(`event-state-${code}`)
      await expect(state, code).toBeVisible()
      const toggle = page.getByTestId(`event-toggle-${code}`).locator('input')
      if (ACTIONABLE.has(code)) await expect(toggle, code).toBeChecked()
      else await expect(toggle, code).not.toBeChecked()
    }
    expect(errors, errors.join(' | ')).toEqual([])
  })

  test('превью — на настоящей отменённой заявке, с черновиком текста, без сохранения', async ({
    page,
    request,
  }) => {
    const order = await placeOrder(request)
    await cancelAsGuest(request, order)

    await openEvents(page)
    await page.getByTestId('event-expand-order.cancelled').click()
    const preview = page.getByTestId('event-preview-order.cancelled')

    // Пример — отменённая заявка отеля, и текст собран по ней же.
    const source = preview.getByTestId('event-preview-source')
    await expect(source).toContainText(/№\d+/, { timeout: 20_000 })
    const shown = (await source.innerText()).match(/№(\d+)/)?.[1]
    expect(shown, 'в подписи примера нет номера заявки').toBeTruthy()
    await expect(preview.getByTestId('event-preview-message-subject')).toContainText(`№${shown}`)
    // Отменили только что — это она и есть, если никто не отменил позже.
    expect(Number(shown)).toBeGreaterThanOrEqual(order.number)

    // Кому уйдёт — не пустая рамка: у кухни в демо есть канал.
    await expect(preview.getByTestId('event-preview-recipient').first()).toBeVisible()

    // Черновик виден в превью до сохранения.
    await page.getByTestId('event-subject-order.cancelled-ru').fill('Гость передумал: №{{number}}')
    await page.getByTestId('event-body-order.cancelled-ru').fill('{{room}} · {{reason}}')
    await expect(preview.getByTestId('event-preview-message-subject')).toHaveText(
      `Гость передумал: №${shown}`,
      { timeout: 20_000 },
    )
    await expect(preview.getByTestId('event-preview-message-body')).toContainText('Номер ')
    await expect(page.getByTestId('event-save-order.cancelled')).toBeEnabled()

    // И ничего не сохранено.
    const stored = (await settings(request, token)).find((item) => item.code === 'order.cancelled')
    expect(stored?.setting.customized, 'превью сохранило настройку').toBe(false)
  })

  test('опечатка в подстановке: превью не строится, сохранить нельзя', async ({ page }) => {
    await openEvents(page)
    await page.getByTestId('event-expand-review.low').click()
    await page.getByTestId('event-subject-review.low-ru').fill('Оценка {{ratting}}')
    await page.getByTestId('event-body-review.low-ru').fill('{{comment}}')

    await expect(page.getByText('{{ratting}}').first()).toBeVisible()
    await expect(page.getByTestId('event-save-review.low')).toBeDisabled()
    await expect(page.getByTestId('event-preview-review.low')).not.toContainText('Оценка —')
  })

  test('включение необязательного события сохраняется, «по умолчанию» его снимает', async ({
    page,
    request,
  }) => {
    await openEvents(page)
    const code = 'brand.published_late'

    await page.getByTestId(`event-toggle-${code}`).locator('input').check()
    await page.getByTestId(`event-save-${code}`).click()
    await expect
      .poll(async () => (await settings(request, token)).find((item) => item.code === code)?.setting)
      .toMatchObject({ enabled: true, customized: true })

    await page.getByTestId(`event-reset-${code}`).click()
    await page.getByTestId(`event-save-${code}`).click()
    await expect
      .poll(async () => (await settings(request, token)).find((item) => item.code === code)?.setting)
      .toMatchObject({ enabled: false, customized: false })
  })

  test('консоль платформы: служба расписания показывает виды заданий', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000)
    // Заявка планирует ступени эскалации — задания службы расписания.
    const order = await placeOrder(request)
    try {
      await page.goto('/admin')
      await page.evaluate(() => window.localStorage.clear())
      await page.goto('/admin')
      await page.getByTestId('admin-login-email').fill(PLATFORM.email)
      await page.getByTestId('admin-login-password').fill(PLATFORM.password)
      await page.getByTestId('admin-login-submit').click()
      await expect(page.getByTestId('admin-health')).toBeVisible({ timeout: 20_000 })

      // Круг службы — раз в минуту: разбивка появится на следующем.
      await expect(async () => {
        await page.reload()
        await expect(page.getByTestId('admin-health-scheduler-kinds')).toContainText(
          /ступени эскалации|escalation steps/,
          { timeout: 5_000 },
        )
      }).toPass({ timeout: 120_000, intervals: [10_000] })
      await expect(page.getByTestId('admin-health')).not.toContainText('отложенных публикаций')
    } finally {
      await cancelAsGuest(request, order)
    }
  })
})
