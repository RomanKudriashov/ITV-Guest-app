import { expect, test, type Page } from '@playwright/test'

import { apiToken, CONCIERGE, DEMO_ROOM, moveOrderStatus } from './helpers'

/**
 * Гостевой контур: главная из данных, чат гость↔персонал и отзыв после
 * завершения. Проверяется вживую, без перезагрузок — если бы доставка шла
 * только по F5, тесты бы упали.
 *
 * Чат — та же реконсиляция снимком, что у заказа: сервер шлёт полный снимок
 * треда, обе стороны видят его без ручного обновления.
 */

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`
}

async function enterAsGuest(page: Page, room = DEMO_ROOM): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(room)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 15_000 })
}

async function staffOpensChat(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(CONCIERGE.email)
  await page.getByTestId('login-password').fill(CONCIERGE.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  await page.goto('/tracker')
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('tracker-chat-open').click()
  await expect(page.getByTestId('tracker-chat')).toBeVisible({ timeout: 15_000 })
}

test.describe('Гостевой контур', () => {
  test('главная собрана из данных: секции всех четырёх типов ведут на свои экраны', async ({
    page,
  }) => {
    await enterAsGuest(page)
    // Со входа гость попадает в меню; на главную ведёт нижняя навигация.
    await page.getByTestId('guest-nav-home').click()
    await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })

    // Демо-отель наполнил все четыре типа — все четыре плитки на месте.
    for (const type of ['product', 'service_request', 'slot', 'info']) {
      await expect(page.getByTestId(`guest-home-section-${type}`)).toBeVisible()
    }

    // Плитка ведёт на маршрут из данных, а не по «зашитому» типу.
    await page.getByTestId('guest-home-section-info').click()
    await expect(page).toHaveURL(/\/info/)
  })

  test('чат гость↔персонал: сообщение долетает в обе стороны вживую', async ({ browser }) => {
    const guestContext = await browser.newContext()
    const staffContext = await browser.newContext()
    const guest = await guestContext.newPage()
    const staff = await staffContext.newPage()

    const question = unique('вопрос')
    const answer = unique('ответ')
    const followup = unique('ещё')

    try {
      // --- Гость пишет первым — тред рождается вместе с сообщением. --------
      await enterAsGuest(guest)
      await guest.getByTestId('guest-nav-chat').click()
      await expect(guest.getByTestId('guest-chat')).toBeVisible({ timeout: 15_000 })

      await guest.getByTestId('guest-chat-input').fill(question)
      await guest.getByTestId('guest-chat-send').click()
      await expect(guest.getByTestId('guest-chat')).toContainText(question, { timeout: 15_000 })

      // --- Персонал открывает чат и видит тред гостя. ---------------------
      await staffOpensChat(staff)
      const thread = staff
        .locator('[data-testid^="tracker-chat-thread-"]')
        .filter({ hasText: question })
      await expect(thread).toBeVisible({ timeout: 20_000 })
      await thread.click()
      await expect(staff.getByTestId('tracker-chat-conversation')).toContainText(question, {
        timeout: 15_000,
      })

      // --- Персонал отвечает — гость получает ответ БЕЗ перезагрузки. ------
      await staff.getByTestId('tracker-chat-input').fill(answer)
      await staff.getByTestId('tracker-chat-send').click()
      await expect(staff.getByTestId('tracker-chat-conversation')).toContainText(answer, {
        timeout: 15_000,
      })
      await expect(guest.getByTestId('guest-chat')).toContainText(answer, { timeout: 15_000 })

      // --- Обратная сторона: у персонала тред открыт, сокет жив — новое
      //     сообщение гостя прилетает вживую. ------------------------------
      await guest.getByTestId('guest-chat-input').fill(followup)
      await guest.getByTestId('guest-chat-send').click()
      await expect(staff.getByTestId('tracker-chat-conversation')).toContainText(followup, {
        timeout: 15_000,
      })
    } finally {
      await guestContext.close()
      await staffContext.close()
    }
  })

  test('отзыв доступен только после завершения и сохраняется', async ({ page, request }) => {
    const staff = await apiToken(request)

    await enterAsGuest(page)
    // Салат без обязательных модификаторов — добавляем прямо из списка.
    await page.getByTestId('guest-qty-plus-caesar').click()
    await expect(page.getByTestId('guest-cart-bar')).toBeVisible()
    await page.getByTestId('guest-cart-bar').click()
    await expect(page.getByTestId('guest-cart')).toBeVisible()
    await page.getByTestId('guest-place-order').click()

    await expect(page.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
    const orderId = page.url().split('/orders/')[1]?.split('?')[0]
    expect(orderId, 'id заказа должен быть в адресе').toBeTruthy()

    await page.getByTestId('guest-track-order').click()
    await expect(page.getByTestId('guest-order-timeline')).toBeVisible()
    // До завершения оценивать нечего.
    await expect(page.getByTestId('guest-review')).toBeHidden()

    // Кухня завершает заказ — блок отзыва появляется на той же странице вживую.
    await moveOrderStatus(request, staff, orderId as string, 'done')
    await expect(page.getByTestId('guest-review')).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('guest-review-star-5').click()
    await page.getByTestId('guest-review-comment').fill('Всё отлично, спасибо')
    await page.getByTestId('guest-review-submit').click()

    // После отправки блок показывает уже оставленный отзыв (только для чтения):
    // текст гостя на месте, форма исчезает — оценить повторно нельзя.
    await expect(page.getByTestId('guest-review')).toContainText('Всё отлично, спасибо', {
      timeout: 15_000,
    })
    await expect(page.getByTestId('guest-review-submit')).toBeHidden()

    // Отзыв действительно сохранён — проверяем на бэкенде тем же токеном
    // сессии, что оформила заказ (отзыв привязан к заявке этой сессии).
    const guestToken = await page.evaluate(() => window.localStorage.getItem('itv.guest.token'))
    expect(guestToken, 'токен гостевой сессии').toBeTruthy()
    const review = await request.get(
      `${process.env.E2E_API_URL ?? 'http://localhost:8010'}/api/guest/order/${orderId}/review`,
      { headers: { Authorization: `Bearer ${guestToken}`, 'X-Hotel-Subdomain': 'crystal' } },
    )
    expect(review.ok()).toBeTruthy()
    expect((await review.json()).rating).toBe(5)
  })
})
