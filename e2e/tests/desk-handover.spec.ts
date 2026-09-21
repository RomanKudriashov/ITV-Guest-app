import { expect, test } from './fixtures'

import { API, RECEPTION, apiHeaders, guestSession, signIn, staffToken } from './helpers'

/**
 * ПЕРЕДАЧА ДИАЛОГА ЧЕЛОВЕКУ (пункт 32 разбора).
 *
 * Раньше переписку можно было отдать только отделу — «Поручением», — либо
 * ждать, пока коллега перехватит её сам. Обе дороги говорят «пусть кто-нибудь
 * займётся», а у смены ресепшена это способ потерять гостя: каждый думает,
 * что взял другой.
 */
test('диалог передаётся конкретному сотруднику', async ({ page, request }) => {
  const staff = await staffToken(request, RECEPTION)
  const targets = await (
    await request.get(`${API}/api/tracker/chat/handover-targets`, { headers: apiHeaders(staff) })
  ).json()
  test.skip(
    (targets.items ?? []).length === 0,
    'на ресепшене стенда один человек — передавать некому',
  )

  // Свежий диалог, чтобы не трогать чужую переписку.
  const guest = await guestSession(request, '212')
  await request.post(`${API}/api/guest/chat`, {
    headers: { Authorization: `Bearer ${guest}`, 'X-Hotel-Subdomain': 'crystal' },
    data: { body: 'вопрос для передачи' },
  })

  await signIn(page, RECEPTION)
  await page.goto('/tracker/desk')
  await page.locator('[data-testid^="desk-thread-"]').first().click()

  await page.getByTestId('desk-handover-open').click()
  const list = page.getByTestId('desk-handover-list')
  await expect(list, 'список адресатов пуст — передавать некому').toBeVisible({ timeout: 20_000 })

  const person = targets.items[0]
  await page.getByTestId(`desk-handover-person-${person.id}`).click()
  await page.getByTestId('desk-handover-confirm').click()

  // В переписке остаётся строка: следующий читающий поймёт, почему отвечает
  // другой человек.
  await expect(page.getByTestId('tracker-chat-conversation')).toContainText(person.name, {
    timeout: 20_000,
  })
})

test('передавать можно только тем, кто ведёт переписку', async ({ request }) => {
  const staff = await staffToken(request, RECEPTION)
  const targets = await (
    await request.get(`${API}/api/tracker/chat/handover-targets`, { headers: apiHeaders(staff) })
  ).json()

  // В списке нет ни повара, ни горничной: право передать равно праву читать.
  const cooks = await (
    await request.get(`${API}/api/cms/staff?search=chef`, { headers: apiHeaders(staff) })
  ).json()
  if (cooks.items?.length) {
    const ids = new Set((targets.items ?? []).map((row: { id: string }) => row.id))
    for (const cook of cooks.items) expect(ids.has(cook.id)).toBeFalsy()
  }
})
