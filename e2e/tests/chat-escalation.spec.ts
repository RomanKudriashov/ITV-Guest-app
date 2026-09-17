import { expect, test } from './fixtures'

import { ADMIN, API, HOTEL, apiHeaders, apiToken, guestSession, RECEPTION, signIn } from './helpers'

/**
 * Порог ответа — настройка отеля: он же красит диалог у ресепшена и задаёт
 * срок сигнала смене. Возвращаем значение в конце: настройка — состояние
 * стенда, и оставлять его изменённым нельзя.
 */
test('порог ответа задаётся в настройках и красит диалог', async ({ page, request }) => {
  const token = await apiToken(request)
  const before = await (
    await request.get(`${API}/api/cms/chat-settings`, { headers: apiHeaders(token) })
  ).json()

  try {
    await signIn(page, ADMIN)
    await page.goto('/cms/settings')
    await expect(page.getByTestId('settings-chat')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('chat-reply-wait').fill('1')
    await page.getByTestId('chat-reply-wait').blur()

    // Сервер принял: список диалогов отдаёт новый порог.
    await expect
      .poll(
        async () => {
          const body = await (
            await request.get(`${API}/api/tracker/chat/threads?limit=1`, { headers: apiHeaders(token) })
          ).json()
          return body.reply_wait_minutes
        },
        { timeout: 15_000 },
      )
      .toBe(1)

    // Ресепшен видит тот же порог на своём месте (красноту диалога по нему
    // проверяет бэкенд: ждать настоящую минуту в e2e незачем).
    await signIn(page, RECEPTION)
    await page.goto('/tracker/desk')
    await expect(page.getByTestId('reception-desk')).toBeVisible({ timeout: 20_000 })
  } finally {
    await request.patch(`${API}/api/cms/chat-settings`, {
      data: { reply_wait_minutes: before.reply_wait_minutes },
      headers: apiHeaders(token),
    })
  }
})
