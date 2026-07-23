import { expect, test, type Page } from '@playwright/test'

import { CONCIERGE, DEMO_ROOM } from './helpers'

/**
 * Второй тип предложения проходит тот же путь, что и еда.
 *
 * Это архитектурная проверка: гость заполняет ФОРМУ вместо корзины, заявка
 * уходит в ДРУГОЙ отдел — но подтверждение, живой статус и доска у неё те же.
 * Если бы для услуг завели параллельный поток, этот тест пришлось бы писать
 * с другими селекторами статуса и другой доской.
 */

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

async function conciergeOpensBoard(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(CONCIERGE.email)
  await page.getByTestId('login-password').fill(CONCIERGE.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })

  await page.goto('/tracker')
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })
}

test.describe('Заявка-услуга', () => {
  test('гость заполняет форму → консьерж ведёт заявку → гость видит статусы', async ({
    browser,
  }) => {
    const guestContext = await browser.newContext()
    const staffContext = await browser.newContext()
    const guest = await guestContext.newPage()
    const staff = await staffContext.newPage()

    try {
      await conciergeOpensBoard(staff)

      await enterAsGuest(guest)
      await guest.goto('/services')
      await expect(guest.getByTestId('guest-service-taxi')).toBeVisible({ timeout: 15_000 })
      await guest.getByTestId('guest-service-taxi').click()

      // --- Форма вместо карточки с корзиной ------------------------------
      const form = guest.getByTestId('guest-request-form')
      await expect(form).toBeVisible()

      await guest.getByTestId('guest-field-destination').fill('Аэропорт Пулково')
      await guest.getByTestId('guest-field-when').fill('18:30')
      // «Сколько человек» — счётчик, а не поле ввода: 1 → 3.
      await guest.getByTestId('guest-qty-plus-field-passengers').click()
      await guest.getByTestId('guest-qty-plus-field-passengers').click()

      await guest.getByTestId('guest-request-submit').click()

      // --- Дальше — ТОТ ЖЕ путь, что у еды -------------------------------
      await expect(guest.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
      const numberText = await guest.getByTestId('guest-order-number').innerText()
      const number = numberText.match(/\d+/)?.[0] as string
      expect(number).toBeTruthy()

      await guest.getByTestId('guest-track-order').click()
      await expect(guest.getByTestId('guest-order-timeline')).toBeVisible()

      // --- Доска консьержа: та же карточка, другое тело -------------------
      const card = staff.getByTestId(`tracker-order-${number}`)
      await expect(card).toBeVisible({ timeout: 20_000 })
      await expect(card.getByTestId('tracker-order-fields')).toContainText('Аэропорт Пулково')

      await staff.getByTestId(`tracker-accept-${number}`).click()
      await expect(guest.getByTestId('guest-order-status')).toContainText(/Принят/i, {
        timeout: 20_000,
      })

      await staff.getByTestId(`tracker-status-${number}-preparing`).click()
      await expect(guest.getByTestId('guest-order-status')).toContainText(/Готовится/i, {
        timeout: 20_000,
      })
    } finally {
      await guestContext.close()
      await staffContext.close()
    }
  })

  test('заявку нельзя отправить, пока не заполнены обязательные поля', async ({ page }) => {
    await enterAsGuest(page)
    await page.goto('/services')
    await page.getByTestId('guest-service-taxi').click()

    await expect(page.getByTestId('guest-request-form')).toBeVisible()
    // Ждём именно появления полей: до загрузки карточки форма ещё не знает,
    // что обязательно, и кнопка успевает побыть активной.
    await expect(page.getByTestId('guest-field-destination')).toBeVisible()

    await expect(page.getByTestId('guest-request-submit')).toBeDisabled()

    await page.getByTestId('guest-field-destination').fill('Эрмитаж')
    await expect(page.getByTestId('guest-request-submit')).toBeDisabled()

    await page.getByTestId('guest-field-when').fill('12:00')
    await expect(page.getByTestId('guest-request-submit')).toBeEnabled()

    await page.getByTestId('guest-request-submit').click()
    await expect(page.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
  })

  test('у заявки не спрашивают, куда доставить', async ({ page }) => {
    await enterAsGuest(page)
    await page.goto('/services')
    await page.getByTestId('guest-service-taxi').click()

    // Точка подачи — поле заявки; выбор локации доставки здесь бессмыслен.
    await expect(page.getByTestId('guest-location-in_room')).toBeHidden()
  })

  test('кухня не видит заявку такси', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-email').fill('chef@crystal.local')
    await page.getByTestId('login-password').fill('chef12345')
    await page.getByTestId('login-submit').click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })

    await page.goto('/tracker')
    await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('tracker-board')).not.toContainText('Аэропорт Пулково')
  })
})
