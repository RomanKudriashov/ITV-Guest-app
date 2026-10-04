import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { DEMO_ROOM } from './helpers'

/**
 * ТЕКСТЫ ГОСТЯ — ПО ВИДУ УСЛУГИ, А НЕ ОДНОЙ ФРАЗОЙ НА ВСЕХ (E2E-004).
 *
 * После заявки в прачечную гость читал «Мы уже передали её на кухню», а в
 * окне отмены — «пока отель не начал готовить». Фразы писались под еду и
 * остались общими. Вид карточки (`card_kind`) приходит с сервера из того же
 * реестра типов сервиса, что и тип трекера персонала, — по нему и выбираются.
 */

const KITCHEN = /кухн|готовить|готовят|kitchen|prepar/i

async function enterAsGuest(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })
}

test('заявка консьержу: ни в подтверждении, ни в отмене нет «кухни»', async ({ page }) => {
  await enterAsGuest(page)
  await page.goto('/venue/concierge')
  await page.getByTestId('guest-service-laundry-service').click()
  await expect(page.getByTestId('guest-request-form')).toBeVisible()
  await page.getByTestId('guest-field-when').fill('12:00')
  await page.getByTestId('guest-request-submit').click()

  const confirmation = page.getByTestId('guest-confirmation')
  await expect(confirmation).toBeVisible({ timeout: 20_000 })
  // Заявка только что ушла и ещё новая: плашка говорит «отправлена», а не
  // «приняли» (партия 31, DEV-06). Слова вида — после принятия.
  await expect(confirmation).toContainText(/Заявка отправлена|Request sent/)
  await expect(confirmation).not.toContainText(KITCHEN)

  // Срок заявки — выбранное гостем время, а не «создание + 25 минут» (E2E-005).
  await page.getByTestId('guest-track-order').click()
  await expect(page.getByTestId('guest-order-status')).toContainText('12:00')
  await page.getByTestId('guest-nav-home').click()
  const strip = page.getByTestId('guest-active-order-strip')
  // После полудня 12:00 — завтра, и с партии 30 (п.46) срок не сегодня
  // показывается с датой: «на пн, 5 окт., 12:00».
  await expect(strip).toContainText(/на [^·]*12:00|for [^·]*12:00/, { timeout: 15_000 })
  await expect(strip).not.toContainText(/подадут|served by/)
  await page.goBack()
  await expect(page.getByTestId('guest-order-status')).toBeVisible()

  await page.getByTestId('guest-cancel-order').click()
  const dialog = page.getByTestId('guest-cancel')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(/взяли в работу|taken into work/)
  await expect(dialog).not.toContainText(KITCHEN)
  // Заявку отменяем: прачечная в демо-отеле не должна копить тестовые заявки.
  await page.getByTestId('guest-cancel-confirm').click()
})
