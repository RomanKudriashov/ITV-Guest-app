import { expect, test, type Page } from '@playwright/test'

import { apiToken, CONCIERGE, DEMO_ROOM, HOTEL, staffToken } from './helpers'

/**
 * Типы info и slot проходят тем же гостевым потоком, что еда и заявки.
 *
 * info — страница только для чтения (без кнопки заказа). slot — бронь: дата →
 * свободный слот → бронирование → подтверждение → доска SPA → отмена
 * освобождает слот. Оба — та же витрина и тот же трекер, без параллельных
 * экранов.
 */

const SPA = { email: 'spa@crystal.local', password: 'chef12345' }

async function enterAsGuest(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  // Продуктовое поведение: после входа гость попадает на главную; для
  // сценариев заказа сразу уходим в меню нижней навигацией.
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('guest-nav-menu').click()
  await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 15_000 })
}

async function staffOpensBoard(page: Page, creds: { email: string; password: string }): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(creds.email)
  await page.getByTestId('login-password').fill(creds.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  await page.goto('/tracker')
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })
}

test.describe('Тип info', () => {
  test('инфо-страница читается и не предлагает заказ', async ({ page }) => {
    await enterAsGuest(page)
    await page.goto('/info')

    await expect(page.getByTestId('guest-info-wifi')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('guest-info-wifi').click()

    const content = page.getByTestId('guest-info-content')
    await expect(content).toBeVisible()
    await expect(content).toContainText(/Crystal-Guest/)

    // Никакой кнопки заказа/брони на инфо-странице.
    await expect(page.getByTestId('guest-add-to-cart')).toBeHidden()
    await expect(page.getByTestId('guest-slot-book')).toBeHidden()
  })
})

test.describe('Тип slot', () => {
  test('гость бронирует слот → доска SPA видит → отмена освобождает', async ({
    browser,
    request,
  }) => {
    const guestContext = await browser.newContext()
    const staffContext = await browser.newContext()
    const guest = await guestContext.newPage()
    const staff = await staffContext.newPage()

    try {
      await staffOpensBoard(staff, SPA)

      await enterAsGuest(guest)
      await guest.goto('/slots')
      await expect(guest.getByTestId('guest-slot-massage')).toBeVisible({ timeout: 15_000 })
      await guest.getByTestId('guest-slot-massage').click()

      // Выбор даты → сетка слотов.
      const form = guest.getByTestId('guest-slot-form')
      await expect(form).toBeVisible()

      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const dateStr = tomorrow.toISOString().slice(0, 10)
      await guest.getByTestId('guest-slot-date').fill(dateStr)

      // Первый доступный слот кликабелен.
      const firstSlot = guest.locator('[data-testid^="guest-slot-"][data-testid*="T"]').first()
      await expect(firstSlot).toBeVisible({ timeout: 15_000 })
      await firstSlot.click()

      await guest.getByTestId('guest-slot-book').click()

      // Дальше — общий поток: подтверждение + живой статус.
      await expect(guest.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
      const number = (await guest.getByTestId('guest-order-number').innerText()).match(/\d+/)?.[0]
      expect(number).toBeTruthy()

      await guest.getByTestId('guest-track-order').click()
      await expect(guest.getByTestId('guest-order-timeline')).toBeVisible()

      // Бронь на доске SPA — тело карточки показывает слот.
      const card = staff.getByTestId(`tracker-order-${number}`)
      await expect(card).toBeVisible({ timeout: 20_000 })
      await expect(card.getByTestId('tracker-order-slot')).toContainText(/Массаж/)

      // Отмена гостем — слот освобождается (проверяем на API).
      const orderId = guest.url().split('/orders/')[1]?.split('?')[0] as string
      const cancelBtn = guest.getByTestId('guest-cancel-order')
      if (await cancelBtn.isVisible().catch(() => false)) {
        await cancelBtn.click()
        const confirm = guest.getByTestId('guest-cancel-confirm')
        if (await confirm.isVisible().catch(() => false)) await confirm.click()
      } else {
        // Кнопки нет (статус уже не позволяет) — отменяем через API.
        const token = await apiToken(request)
        await request.post(`http://localhost:8010/api/orders/${orderId}/status`, {
          data: { status: 'cancelled' },
          headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
        })
      }

      // Слот снова свободен: capacity_left вернулось (спустя отмену).
      const guestApiToken = await request
        .post('http://localhost:8010/api/guest/session', {
          data: { room_number: DEMO_ROOM },
          headers: { 'X-Hotel-Subdomain': HOTEL },
        })
        .then((r) => r.json())
        .then((j) => j.token)

      // Находим item id массажа и проверяем доступность.
      const catalog = await request
        .get('http://localhost:8010/api/guest/catalog?type=slot', {
          headers: { Authorization: `Bearer ${guestApiToken}`, 'X-Hotel-Subdomain': HOTEL },
        })
        .then((r) => r.json())
      const massageId = catalog.categories
        .flatMap((c: { items: { code: string; id: string }[] }) => c.items)
        .find((i: { code: string }) => i.code === 'massage').id

      await expect
        .poll(async () => {
          const slots = await request
            .get(
              `http://localhost:8010/api/guest/slots?item_id=${massageId}&date=${dateStr}`,
              { headers: { Authorization: `Bearer ${guestApiToken}`, 'X-Hotel-Subdomain': HOTEL } },
            )
            .then((r) => r.json())
          // после отмены все слоты снова с полной вместимостью
          return slots.slots.every((s: { capacity_left: number }) => s.capacity_left === 2)
        })
        .toBeTruthy()
    } finally {
      await guestContext.close()
      await staffContext.close()
    }
  })
})
