import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, DEMO_ROOM, HOTEL } from './helpers'

/**
 * РЕЖИМ КОНДИЦИОНЕРА И SOS (партия 65).
 *
 * У демо-отеля этих каналов нет, поэтому снимок номера подставляется: настоящий
 * снимок, в который добавлены режимы кондиционера и элемент SOS той формы, что
 * отдаёт сервер (таблица `range.mode.modes`, вопрос `confirm`). Проверяется
 * экран: режимы — сегменты с иконкой и подписью, глиф кондиционера — текущий
 * режим, SOS спрашивает перед вызовом, и «Отмена» не отправляет ничего.
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
}

test('режимы — сегментами, SOS — с вопросом, отмена ничего не шлёт', async ({ page }) => {
  const session = await page.request.post(`${API}/api/v1/guest/session`, { data: { room_number: DEMO_ROOM, language: 'ru' }, headers: { 'X-Hotel-Subdomain': HOTEL } })
  const real = await (await page.request.get(`${API}/api/v1/guest/room/state`, { headers: { Authorization: `Bearer ${(await session.json()).token}`, 'X-Hotel-Subdomain': HOTEL } })).json()

  const zones = real.zones as Array<{ controls: Array<Record<string, unknown>> }>
  const ac = zones.flatMap((z) => z.controls).find((c) => (c.capabilities as string[]).includes('setpoint'))
  expect(ac, 'у демо-номера есть кондиционер').toBeTruthy()
  ac!.capabilities = [...(ac!.capabilities as string[]), 'mode']
  ac!.range = { ...(ac!.range as object), mode: { min: 0, max: 2, step: 1, modes: [{ value: 0, mode: 'cool' }, { value: 1, mode: 'heat' }, { value: 2, mode: 'fan' }] } }
  ac!.value = { ...(ac!.value as object), on: 1, mode: 0 }
  ac!.state = 'confirmed'
  zones[0].controls.push({
    controlId: 'sos.e2e', kind: 'sos', title: 'Вызов помощи', icon: 'sos',
    labels: { on: 'помощь вызвана', off: 'не вызвана' },
    confirm: 'Вызвать помощь? Сотрудник отеля придёт в номер.',
    capabilities: ['toggle'], value: 0, state: 'confirmed', readonly: false,
  })

  // Подмена ДО входа: главная берёт тот же снимок для строки состояния.
  await page.routeWebSocket('**/ws/**', (ws) => ws.close())
  await page.route('**/api/v1/guest/room/state', (route) => route.fulfill({ json: real }))
  await enterRoom(page)
  const commands: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/guest/room/command') || request.url().includes('/guest/room/commands')) commands.push(request.postData() ?? '')
  })

  await page.getByTestId('guest-nav-room').click()
  const segments = page.getByTestId(`room-mode-${ac!.controlId}`)
  await expect(segments).toBeVisible({ timeout: 20_000 })
  for (const [value, name] of [[0, 'Охлаждение'], [1, 'Нагрев'], [2, 'Вентилятор']] as const) {
    await expect(page.getByTestId(`room-mode-${ac!.controlId}-${value}`)).toHaveAttribute('aria-label', name)
    await expect(page.getByTestId(`room-mode-${ac!.controlId}-${value}`).locator('svg')).toHaveCount(1)
  }
  await expect(page.getByTestId(`room-mode-${ac!.controlId}-0`)).toHaveAttribute('aria-pressed', 'true')

  const sos = page.locator('[data-testid="room-control-sos.e2e"]').first()
  await sos.scrollIntoViewIfNeeded()
  await sos.click()
  const dialog = page.getByTestId('room-confirm-sos.e2e')
  await expect(dialog).toContainText('Вызвать помощь?')
  await page.getByTestId('room-confirm-cancel').click()
  await expect(dialog).toBeHidden()
  await page.waitForTimeout(800)
  expect(commands.filter((body) => body.includes('sos.e2e')), 'отмена не шлёт команду').toHaveLength(0)
})
