import { type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

import {
  ADMIN,
  API,
  CREDENTIALS,
  DEMO_ROOM,
  HOTEL,
  PLATFORM,
  RESTAURANT_MANAGER,
  apiHeaders,
  signIn,
  signInToCms,
  staffToken,
} from './helpers'

/**
 * БОТ ПЛАТФОРМЫ В TELEGRAM (партия 28) — целиком, живыми службами.
 *
 * Настоящий Telegram не трогается: служба `bot` и воркер в разработке говорят
 * с эмулятором Bot API (`telegram-emulator`, порт 1087). Через его управление
 * проверка «пишет боту» и «жмёт кнопку» — дальше работают настоящие служба
 * опроса, привязка, эскалация, воркер и правка сообщения.
 *
 * Условия задаются явно и возвращаются: привязки снимаются, правило кухни
 * восстанавливается, заказ закрывается.
 */

const TG = process.env.E2E_TELEGRAM_EMULATOR ?? 'http://localhost:1087'
const CONTACTS = `${API}/api/staff/me/contacts`

interface BotMessage {
  message_id: number
  chat_id: string
  text: string
  plain: string
  buttons: Array<{ text: string; callback_data?: string; url?: string }>
}

const chat = () => 800_000_000 + Math.floor(Math.random() * 99_999_999)

async function botMessages(request: APIRequestContext, chatId: number): Promise<BotMessage[]> {
  const response = await request.get(`${TG}/_emulator/messages?chat_id=${chatId}`)
  expect(response.ok(), 'эмулятор Telegram не отвечает — поднят ли telegram-emulator?').toBeTruthy()
  return (await response.json()).messages
}

async function writeToBot(request: APIRequestContext, chatId: number, text: string) {
  const response = await request.post(`${TG}/_emulator/message`, { data: { chat_id: chatId, text } })
  expect(response.ok()).toBeTruthy()
}

async function bindByApi(request: APIRequestContext, credentials: typeof ADMIN, chatId: number): Promise<string> {
  const token = await staffToken(request, credentials)
  const issued = await request.post(`${CONTACTS}/telegram/binding-code`, { headers: apiHeaders(token) })
  expect(issued.status(), await issued.text()).toBe(200)
  await writeToBot(request, chatId, `/start ${(await issued.json()).code}`)
  await expect
    .poll(async () => (await (await request.get(CONTACTS, { headers: apiHeaders(token) })).json()).messengers.telegram.linked, {
      timeout: 30_000,
    })
    .toBe(true)
  return token
}

async function unbind(request: APIRequestContext, credentials: typeof ADMIN) {
  const token = await staffToken(request, credentials)
  await request.delete(`${CONTACTS}/telegram`, { headers: apiHeaders(token) })
}

test.describe('Бот Telegram', () => {
  test.describe.configure({ mode: 'serial' })

  test('повар подключает Telegram из профиля: ссылка на бота, код боту, «Подключено»', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const chefChat = chat()
    await unbind(request, CREDENTIALS)
    try {
      await signIn(page, CREDENTIALS)
      await page.goto('/cms/profile')
      const connect = page.getByTestId('profile-messenger-telegram-connect')
      await expect(connect).toBeEnabled({ timeout: 20_000 })
      await connect.click()

      // Имя бота — от Telegram (getMe), а не из настроек.
      const link = page.getByTestId('profile-messenger-telegram-code').getByRole('link')
      await expect(link).toHaveAttribute('href', /^https:\/\/t\.me\/itv_emulator_bot\?start=/)
      const code = new URL((await link.getAttribute('href')) as string).searchParams.get('start')
      await writeToBot(request, chefChat, `/start ${code}`)

      await expect
        .poll(async () => (await botMessages(request, chefChat)).map((m) => m.plain).join('\n'), { timeout: 30_000 })
        .toContain('Подключено: ')
      await page.reload()
      await expect(page.getByTestId('profile-messenger-telegram-linked')).toBeVisible({ timeout: 20_000 })

      // Max — только интерфейс: бота нет, и кнопка честно выключена.
      await expect(page.getByTestId('profile-messenger-max-connect')).toBeDisabled()
      await expect(page.getByTestId('profile-messenger-max-unavailable')).toBeVisible()

      // Администратор видит, что повар подключён, и итог доставки.
      await signInToCms(page, ADMIN)
      await page.goto('/cms/staff')
      await expect(page.getByTestId(`staff-messenger-${CREDENTIALS.email}-telegram`)).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId(`staff-telegram-last-${CREDENTIALS.email}`)).toBeVisible()

      // Отвязка командой боту — без пароля и без панели.
      await writeToBot(request, chefChat, '/stop')
      const chefToken = await staffToken(request, CREDENTIALS)
      await expect
        .poll(async () => (await (await request.get(CONTACTS, { headers: apiHeaders(chefToken) })).json()).messengers.telegram.linked, {
          timeout: 30_000,
        })
        .toBe(false)
    } finally {
      await unbind(request, CREDENTIALS)
    }
  })

  test('кнопка «Взять в работу»: руководитель берёт заказ кухни из Telegram', async ({ request }) => {
    test.setTimeout(150_000)
    const managerChat = chat()
    const adminToken = await staffToken(request, ADMIN)
    const managerToken = await bindByApi(request, RESTAURANT_MANAGER, managerChat)

    // Первая ступень правила кухни — руководителям: им и придёт личное сообщение.
    // Правило ищется по точке исполнения с кодом `kitchen`, а не по имени
    // (партия 41, п.28): название правила — данные сида, его можно переименовать.
    const kitchen = (
      (await (await request.get(`${API}/api/cms/bootstrap`, { headers: apiHeaders(adminToken) })).json()).execution_points as Array<{
        id: string
        code: string
      }>
    ).find((p) => p.code === 'kitchen')
    expect(kitchen, 'у демо-отеля нет точки исполнения kitchen').toBeTruthy()
    const rules = (await (await request.get(`${API}/api/cms/escalation-rules?limit=100`, { headers: apiHeaders(adminToken) })).json())
      .items as Array<{ id: string; execution_point_id: string | null; is_active: boolean; steps: Array<Record<string, unknown>> }>
    const rule = rules.find((r) => r.is_active && r.execution_point_id === kitchen!.id)
    expect(rule, 'у кухни демо-отеля нет активного правила эскалации').toBeTruthy()
    const original = rule!.steps.map((s) => ({
      delay_minutes: s.delay_minutes,
      target_kind: s.target_kind,
      channel_id: s.channel_id ?? null,
      title: s.title ?? '',
    }))
    const immediate = original.findIndex((s) => s.delay_minutes === 0)
    expect(immediate, 'у правила кухни нет ступени «сразу»').toBeGreaterThanOrEqual(0)
    const patched = original.map((s, i) => (i === immediate ? { ...s, target_kind: 'manager', channel_id: null } : s))

    let orderId = ''
    try {
      const saved = await request.patch(`${API}/api/cms/escalation-rules/${rule!.id}`, {
        data: { steps: patched },
        headers: apiHeaders(adminToken),
      })
      expect(saved.ok(), await saved.text()).toBeTruthy()

      const session = await request.post(`${API}/api/guest/session`, {
        data: { room_number: DEMO_ROOM },
        headers: { 'X-Hotel-Subdomain': HOTEL },
      })
      const guest = { Authorization: `Bearer ${(await session.json()).token}`, 'X-Hotel-Subdomain': HOTEL }
      const catalog = JSON.stringify(await (await request.get(`${API}/api/guest/catalog`, { headers: guest })).json())
      const caesar = /"id":\s*"([0-9a-f-]{36})"[^{}]*"code":\s*"caesar"/.exec(catalog)?.[1]
      expect(caesar, 'в каталоге нет «Цезаря»').toBeTruthy()
      const created = await request.post(`${API}/api/guest/order`, {
        data: { lines: [{ item_id: caesar, quantity: 1 }] },
        headers: { ...guest, 'Idempotency-Key': `e2e-tg-${Date.now()}` },
      })
      expect(created.ok(), await created.text()).toBeTruthy()
      const order = await created.json()
      orderId = order.id

      // Личное сообщение руководителю — HTML, с кнопкой.
      let message: BotMessage | undefined
      await expect
        .poll(
          async () => {
            message = (await botMessages(request, managerChat)).find((m) =>
              m.buttons.some((b) => b.callback_data === `o:${order.id.replaceAll('-', '')}`),
            )
            return message?.buttons.map((b) => b.callback_data ?? '') ?? []
          },
          { timeout: 60_000, message: 'сообщение с кнопкой не пришло — жив ли воркер?' },
        )
        .toContain(`o:${order.id.replaceAll('-', '')}`)
      expect(message!.text.startsWith('<b>'), 'разметка — HTML, не Markdown').toBeTruthy()

      const press = await request.post(`${TG}/_emulator/press`, {
        data: { chat_id: managerChat, message_id: message!.message_id, data: `o:${order.id.replaceAll('-', '')}` },
      })
      expect(press.ok()).toBeTruthy()

      await expect
        .poll(async () => (await botMessages(request, managerChat)).find((m) => m.message_id === message!.message_id)?.plain ?? '', {
          timeout: 30_000,
        })
        .toMatch(/Взял .+, \d\d:\d\d/)
      const board = await request.get(`${API}/api/tracker/order/${order.id}`, { headers: apiHeaders(managerToken) })
      expect((await board.json()).assignee, 'заказ не взят').toBeTruthy()
    } finally {
      await request.patch(`${API}/api/cms/escalation-rules/${rule!.id}`, {
        data: { steps: original },
        headers: apiHeaders(adminToken),
      })
      await unbind(request, RESTAURANT_MANAGER)
      if (orderId) {
        await request.post(`${API}/api/orders/${orderId}/status`, {
          data: { status: 'done', cancel_reason: 'mistake' },
          headers: apiHeaders(managerToken),
        })
      }
    }
  })

  test('консоль платформы и экран уведомлений видят бота', async ({ page }) => {
    test.setTimeout(90_000)
    await signInToCms(page, ADMIN)
    await page.goto('/cms/notifications')
    await expect(page.getByTestId('notifications-telegram-bot')).toContainText('@itv_emulator_bot', { timeout: 20_000 })
    await expect(page.getByTestId('notifications-telegram-switch')).toBeEnabled()

    await page.goto('/admin')
    await page.evaluate(() => window.localStorage.clear())
    await page.goto('/admin')
    await page.getByTestId('admin-login-email').fill(PLATFORM.email)
    await page.getByTestId('admin-login-password').fill(PLATFORM.password)
    await page.getByTestId('admin-login-submit').click()
    await expect(page.getByTestId('admin-health-bot_ok')).toContainText('@itv_emulator_bot', { timeout: 20_000 })
  })
})
