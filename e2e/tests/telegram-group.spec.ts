import { type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken, signInToCms } from './helpers'

/**
 * TELEGRAM-ГРУППА ЧЕРЕЗ БОТА ПЛАТФОРМЫ — ПУТЬ ЧЕЛОВЕКА (партия 32).
 *
 * Панель → «Telegram-группа» → код в диалоге → в группе `/connect КОД` →
 * панель «Подключена» → бота удалили → «Бота удалили из группы» → канал
 * удалён → бот прощается и выходит. Группа — на эмуляторе Bot API, служба
 * бота — настоящая (контейнер `bot`).
 */

const TG = process.env.E2E_TELEGRAM_EMULATOR ?? 'http://localhost:1087'

async function inGroup(request: APIRequestContext, chat: number, text: string) {
  const response = await request.post(`${TG}/_emulator/message`, {
    data: { chat_id: chat, text, chat_type: 'group', chat_title: 'Кухня — смена' },
  })
  expect(response.ok()).toBeTruthy()
}

async function groupMessages(request: APIRequestContext, chat: number): Promise<string> {
  const response = await request.get(`${TG}/_emulator/messages?chat_id=${chat}`)
  return ((await response.json()).messages as Array<{ plain: string }>).map((m) => m.plain).join('\n')
}

test('группа: код из панели, /connect, «Подключена», бот удалён, канал удалён — бот вышел', async ({ page, request }) => {
  test.setTimeout(180_000)
  const chat = -Number(String(Date.now()).slice(-9))
  const admin = await apiToken(request, ADMIN)
  const kitchen = (
    (await (await request.get(`${API}/api/cms/bootstrap`, { headers: apiHeaders(admin) })).json()).execution_points as Array<{
      id: string
      code: string
    }>
  ).find((point) => point.code === 'kitchen')!
  const title = `Смена ${Date.now().toString(36)}`

  await signInToCms(page, ADMIN)
  await page.goto('/cms/notifications')
  await page.getByTestId('cms-channel-add').click()
  await page.getByTestId('cms-channel-type').selectOption('telegram_group')
  await page.getByTestId('cms-channel-title').fill(title)
  await page.getByTestId('cms-channel-binding').selectOption('point')
  await page.getByTestId('cms-channel-point').selectOption(kitchen.id)
  await page.getByTestId('cms-channel-save').click()

  const shown = (await page.getByTestId('cms-group-code').textContent({ timeout: 20_000 }))!.trim()
  // Команда — с именем бота: так её получит бот и в группе с режимом приватности.
  expect(shown).toMatch(/^\/connect@itv_emulator_bot [A-Z2-9]{8}$/)
  const code = shown.split(' ').pop()!
  expect(code).toMatch(/^[A-Z2-9]{8}$/)
  await expect(page.getByTestId('cms-group-link')).toHaveAttribute('href', new RegExp(`startgroup=${code}$`))

  await inGroup(request, chat, shown)
  await expect.poll(() => groupMessages(request, chat), { timeout: 30_000 }).toContain('Группа подключена')

  const channels = (await (await request.get(`${API}/api/cms/notification-channels?limit=200`, { headers: apiHeaders(admin) })).json())
    .items as Array<{ id: string; title: string }>
  const channel = channels.find((item) => item.title === title)!
  try {
    await page.reload()
    await expect(page.getByTestId(`cms-channel-group-state-${channel.id}`)).toHaveText('Подключена', { timeout: 20_000 })

    // Бота удалили из группы — панель говорит об этом прямо.
    await request.post(`${TG}/_emulator/member`, { data: { chat_id: chat, status: 'kicked' } })
    await expect
      .poll(
        async () => {
          await page.reload()
          return page.getByTestId(`cms-channel-group-state-${channel.id}`).textContent()
        },
        { timeout: 30_000 },
      )
      .toBe('Бота удалили из группы')
  } finally {
    await request.delete(`${API}/api/cms/notification-channels/${channel.id}`, { headers: apiHeaders(admin) })
  }
})

test('удаление подключённой группы в панели — бот прощается и выходит', async ({ request }) => {
  const chat = -Number(String(Date.now() + 7).slice(-9))
  const admin = await apiToken(request, ADMIN)
  const created = await (
    await request.post(`${API}/api/cms/notification-channels/telegram-group`, {
      headers: apiHeaders(admin),
      data: { title: `Прощание ${Date.now().toString(36)}`, execution_point_id: null },
    })
  ).json()
  await inGroup(request, chat, `/connect ${created.connect.code}`)
  await expect.poll(() => groupMessages(request, chat), { timeout: 30_000 }).toContain('Группа подключена')
  await request.delete(`${API}/api/cms/notification-channels/${created.channel.id}`, { headers: apiHeaders(admin) })
  await expect.poll(() => groupMessages(request, chat), { timeout: 30_000 }).toContain('бот выходит из группы')
  const calls = await (await request.get(`${TG}/_emulator/calls?method=leaveChat`)).json()
  expect((calls.calls as Array<{ payload: { chat_id: unknown } }>).map((c) => String(c.payload.chat_id))).toContain(String(chat))
})
