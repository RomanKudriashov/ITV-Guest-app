import { type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, HOTEL, guestSession, RECEPTION, signIn } from './helpers'

/**
 * Рабочее место ресепшена: долго ждущий диалог красный, карточка гостя
 * знает контекст, занятый коллегой диалог подписан «отвечает …».
 */

const DARYA = { email: 'manager.reception@crystal.local', password: 'chef12345' }

async function guestWrites(request: APIRequestContext, body: string): Promise<string> {
  const token = await guestSession(request, '212')
  const response = await request.post(`${API}/api/guest/chat`, {
    data: { body },
    headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).thread_id
}

test('рабочее место: три колонки, карточка гостя и «отвечает Дарья»', async ({ browser, request }) => {
  const question = `нужен утюг ${Date.now().toString(36)}`
  const threadId = await guestWrites(request, question)

  const igorContext = await browser.newContext()
  const daryaContext = await browser.newContext()
  try {
    const igor = await igorContext.newPage()
    await signIn(igor, RECEPTION)
    await igor.goto(`/tracker/desk?t=${threadId}`)
    await expect(igor.getByTestId('reception-desk')).toBeVisible({ timeout: 20_000 })
    await expect(igor.getByTestId(`desk-thread-${threadId}`)).toBeVisible({ timeout: 15_000 })
    await expect(igor.getByTestId('tracker-chat-conversation')).toContainText(question, { timeout: 15_000 })
    await expect(igor.getByTestId('desk-guest-card')).toBeVisible()
    await expect(igor.getByTestId('desk-guest-room')).toContainText('212')
    // Игорь открыл — у него баннера «занято» нет.
    await expect(igor.getByTestId('desk-holder-banner')).toHaveCount(0)

    const darya = await daryaContext.newPage()
    await signIn(darya, DARYA)
    await darya.goto('/tracker/desk')
    await expect(darya.getByTestId(`desk-thread-holder-${threadId}`)).toContainText('Отвечает', {
      timeout: 20_000,
    })
    await darya.getByTestId(`desk-thread-${threadId}`).click()
    await expect(darya.getByTestId('desk-holder-banner')).toBeVisible({ timeout: 15_000 })
    await darya.getByTestId('desk-take').click()
    await expect(darya.getByTestId('desk-holder-banner')).toHaveCount(0, { timeout: 15_000 })
  } finally {
    await igorContext.close()
    await daryaContext.close()
  }
})

test('администратор видит пункт «Ресепшен» в меню и попадает на рабочее место', async ({ page }) => {
  await signIn(page, ADMIN)
  await page.goto('/cms/dashboard')
  await page.getByTestId('cms-nav-desk').click()
  await expect(page).toHaveURL(/\/tracker\/desk/)
  await expect(page.getByTestId('reception-desk')).toBeVisible({ timeout: 20_000 })
})
