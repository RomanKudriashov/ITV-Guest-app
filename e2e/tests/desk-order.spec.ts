import { type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, CREDENTIALS, HOTEL, RECEPTION, guestSession, signIn } from './helpers'

/**
 * Заказ от имени гостя: ресепшен собирает корзину из чата, гость видит заказ
 * у себя с пометкой «оформил Ресепшен» и сообщение об этом в переписке.
 */

function guestHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }
}

async function guestWithDialog(request: APIRequestContext): Promise<{ token: string; threadId: string }> {
  const token = await guestSession(request, '212')
  const response = await request.post(`${API}/api/guest/chat`, {
    data: { body: `принесите что-нибудь ${Date.now().toString(36)}` },
    headers: guestHeaders(token),
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return { token, threadId: (await response.json()).thread_id }
}

test('ресепшен оформляет заказ за гостя из диалога', async ({ page, request }) => {
  const { token, threadId } = await guestWithDialog(request)

  await signIn(page, RECEPTION)
  await page.goto(`/tracker/desk?t=${threadId}`)
  await expect(page.getByTestId('reception-desk')).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('desk-order-open').click()
  await expect(page.getByTestId('desk-order-dialog')).toBeVisible({ timeout: 15_000 })

  await page.getByTestId('desk-order-venue').click()
  await page.getByTestId('desk-order-venue-kitchen').click()
  await expect(page.getByTestId('desk-order-catalog')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('desk-order-add-caesar').click()
  await expect(page.getByTestId('desk-order-qty-caesar')).toHaveText('1')

  // Место — как у гостя: матрица даёт номер гостя.
  await expect(page.getByTestId('desk-order-location-in_room')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('desk-order-total')).not.toHaveText('…', { timeout: 15_000 })

  await page.getByTestId('desk-order-submit').click()
  await expect(page.getByTestId('desk-order-placed')).toBeVisible({ timeout: 20_000 })
  const placedText = (await page.getByTestId('desk-order-placed').innerText()).match(/\d+/)?.[0]
  expect(placedText).toBeTruthy()

  // Гость: заказ у него, с пометкой, и сообщение в чате.
  const orders = await (
    await request.get(`${API}/api/guest/orders`, { headers: guestHeaders(token) })
  ).json()
  const mine = orders.active.find((o: { number: number }) => String(o.number) === placedText)
  expect(mine, 'заказ виден гостю').toBeTruthy()
  expect(mine.placed_by_staff).toBe(true)
  expect(mine.placed_by_label).toBe('Ресепшен')

  const chat = await (await request.get(`${API}/api/guest/chat`, { headers: guestHeaders(token) })).json()
  const note = chat.messages.find((m: { body: string }) => m.body.includes(`№${placedText}`))
  expect(note, 'гостю сказано, что заказ оформлен').toBeTruthy()
  expect(note.author_name).toBe('Ресепшен')

  // Доска кухни (её смотрит повар): видно, кто оформил.
  await signIn(page, CREDENTIALS)
  await page.goto('/tracker')
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId(`tracker-placed-by-${placedText}`)).toBeVisible({ timeout: 20_000 })
})

test('ресепшен передаёт задачу в отдел, переписка остаётся у него', async ({ page, request }) => {
  const { token, threadId } = await guestWithDialog(request)

  await signIn(page, RECEPTION)
  await page.goto(`/tracker/desk?t=${threadId}`)
  await expect(page.getByTestId('reception-desk')).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('desk-task-open').click()
  await expect(page.getByTestId('desk-task-dialog')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('desk-task-point').click()
  await page.getByTestId('desk-task-point-housekeeping').click()
  await page.getByTestId('desk-task-text').fill('принести второе одеяло')
  await page.getByTestId('desk-task-send').click()
  await expect(page.getByTestId('desk-task-sent')).toBeVisible({ timeout: 20_000 })

  // Задача видна в карточке гостя со статусом.
  await expect(page.getByTestId('desk-guest-tasks')).toContainText('принести второе одеяло', {
    timeout: 15_000,
  })

  // Гостю сказано по-человечески, без номера заказа; отвечает по-прежнему ресепшен.
  const chat = await (
    await request.get(`${API}/api/guest/chat`, { headers: guestHeaders(token) })
  ).json()
  const last = chat.messages[chat.messages.length - 1]
  expect(last.body).toContain('Передали')
  expect(last.body).not.toContain('№')
  expect(last.author_name).toBe('Ресепшен')

  // Каталог гостя «Поручения» не знает.
  const menu = await (
    await request.get(`${API}/api/guest/catalog?type=service_request`, {
      headers: guestHeaders(token),
    })
  ).json()
  const titles = menu.categories.flatMap((c: { items: { title: string }[] }) =>
    c.items.map((i) => i.title),
  )
  expect(titles).not.toContain('Поручение')
})
