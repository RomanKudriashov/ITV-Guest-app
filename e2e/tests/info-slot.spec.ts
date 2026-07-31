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
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })
  // К блюдам гость идёт ЧЕРЕЗ заведение: плоского меню отеля больше нет,
  // и путь теста совпадает с путём живого гостя — плитка на главной.
  await page.getByTestId('guest-home-tile-kitchen').click()
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
      await guest.goto('/venue/spa')
      await expect(guest.getByTestId('guest-slot-massage')).toBeVisible({ timeout: 15_000 })
      await guest.getByTestId('guest-slot-massage').click()

      // Выбор даты → сетка слотов.
      const form = guest.getByTestId('guest-slot-form')
      await expect(form).toBeVisible()

      // «Завтра» считаем ОТ ОТЕЛЯ, а не от машины с тестом: у отеля своя
      // таймзона, и около полуночи локальное «завтра» оказывается вчерашним
      // днём отеля. Ленту записей спа сервер уже подписал своим днём.
      const timelineBox = staff.getByTestId('tracker-timeline')
      await expect(timelineBox).toBeVisible({ timeout: 20_000 })
      const hotelToday = (await timelineBox.getAttribute('data-day')) as string
      expect(hotelToday, 'сервер обязан назвать показанный день').toBeTruthy()
      const next = new Date(`${hotelToday}T12:00:00Z`)
      next.setUTCDate(next.getUTCDate() + 1)
      const dateStr = next.toISOString().slice(0, 10)
      await guest.getByTestId('guest-slot-date').fill(dateStr)

      // Первый доступный слот кликабелен. Запоминаем ИМЕННО ЕГО время: проверять
      // потом «весь день пуст» нельзя — в демо-отеле у спа есть и свои записи,
      // и тест не про них, а про то, что освободилась забронированная им ячейка.
      // Именно первый ДОСТУПНЫЙ: занятая ячейка тоже отрисована, просто
      // выключена, и `.first()` без этого фильтра выбирал бы её.
      const firstSlot = guest
        .locator('[data-testid^="guest-slot-"][data-testid*="T"]:not([disabled])')
        .first()
      await expect(firstSlot).toBeVisible({ timeout: 15_000 })
      const bookedStart = (await firstSlot.getAttribute('data-testid'))!.replace(
        'guest-slot-',
        '',
      )
      expect(bookedStart.slice(0, 10), 'сетка обязана показать выбранный день').toBe(dateStr)

      // Свободная вместимость ЭТОЙ ячейки до брони — эталон, к которому она
      // обязана вернуться после отмены.
      const guestApiToken = await request
        .post('http://localhost:8010/api/guest/session', {
          data: { room_number: DEMO_ROOM },
          headers: { 'X-Hotel-Subdomain': HOTEL },
        })
        .then((r) => r.json())
        .then((j) => j.token)
      const catalog = await request
        .get('http://localhost:8010/api/guest/catalog?type=slot', {
          headers: { Authorization: `Bearer ${guestApiToken}`, 'X-Hotel-Subdomain': HOTEL },
        })
        .then((r) => r.json())
      const massageId = catalog.categories
        .flatMap((c: { items: { code: string; id: string }[] }) => c.items)
        .find((i: { code: string }) => i.code === 'massage').id
      const bookedDate = bookedStart.slice(0, 10)

      const capacityOf = async (): Promise<number | undefined> => {
        const slots = await request
          .get(`http://localhost:8010/api/guest/slots?item_id=${massageId}&date=${bookedDate}`, {
            headers: { Authorization: `Bearer ${guestApiToken}`, 'X-Hotel-Subdomain': HOTEL },
          })
          .then((r) => r.json())
        return (slots.slots as Array<{ starts_at: string; capacity_left: number }>).find(
          (slot) => slot.starts_at === bookedStart,
        )?.capacity_left
      }
      const capacityBefore = await capacityOf()
      expect(capacityBefore).toBeGreaterThan(0)

      await firstSlot.click()

      await guest.getByTestId('guest-slot-book').click()

      // Дальше — общий поток: подтверждение + живой статус.
      await expect(guest.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
      const number = (await guest.getByTestId('guest-order-number').innerText()).match(/\d+/)?.[0]
      expect(number).toBeTruthy()

      await guest.getByTestId('guest-track-order').click()
      await expect(guest.getByTestId('guest-order-timeline')).toBeVisible()

      // Спа — не доска, а ЛЕНТА ЗАПИСЕЙ на день (R3). Бронь на завтра видна,
      // только если мастер перелистнул день: сегодня её там и не должно быть.
      const card = staff.getByTestId(`tracker-order-${number}`)
      await expect(staff.getByTestId('tracker-timeline')).toBeVisible({ timeout: 20_000 })
      await expect(card).toBeHidden()

      await staff.getByTestId('tracker-day-next').click()
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

      // Отменённая бронь вернула СВОЮ ячейку — вместимость та же, что и до неё.
      await expect.poll(capacityOf).toBe(capacityBefore)
    } finally {
      await guestContext.close()
      await staffContext.close()
    }
  })
})
