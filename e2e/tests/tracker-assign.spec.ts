import { expect, test } from './fixtures'

import {
  CREDENTIALS,
  RESTAURANT_MANAGER,
  closeOrder,
  placeKitchenOrder,
  signInToTracker,
} from './helpers'

/**
 * НАЗНАЧЕНИЕ ИСПОЛНИТЕЛЯ ЧЕРЕЗ ИНТЕРФЕЙС (партия 47).
 *
 * Повар — старший смены кухни: у него в меню карточки есть «Назначить
 * исполнителя», выбор — из людей кухни. Назначенный видит «Назначено вам», а в
 * журнале заказа — кто кого назначил. Назначение — не «принято»: у назначенного
 * на карточке остаётся «Принять».
 */
test('старший смены назначает исполнителя — тот видит «Назначено вам», журнал называет обоих', async ({
  page,
  browser,
  request,
}) => {
  const order = await placeKitchenOrder(request)
  try {
    await signInToTracker(page, CREDENTIALS)
    const card = page.getByTestId(`tracker-order-${order.number}`)
    await expect(card).toBeVisible({ timeout: 25_000 })

    await page.getByTestId(`tracker-more-${order.number}`).click()
    await page.getByTestId(`tracker-assign-${order.number}`).click()
    const people = page.getByTestId('tracker-assign-people')
    await expect(people).toBeVisible()
    await people.getByLabel(/управляющий/i).check()
    await page.getByTestId('tracker-assign-confirm').click()

    // Назначенный — в своём окне: «Назначено вам» и кнопка «Принять».
    const other = await browser.newContext()
    const managerPage = await other.newPage()
    try {
      await signInToTracker(managerPage, RESTAURANT_MANAGER)
      await managerPage.goto(`/tracker?point=kitchen`)
      await expect(managerPage.getByTestId(`tracker-assigned-to-me-${order.number}`)).toBeVisible({
        timeout: 25_000,
      })
      await expect(managerPage.getByTestId(`tracker-accept-${order.number}`)).toBeVisible()

      await managerPage.goto(`/tracker/order/${order.id}`)
      const journal = managerPage.getByTestId('tracker-order-journal')
      await expect(journal.locator('[data-kind="assign"]')).toContainText(/Назначено/, {
        timeout: 20_000,
      })
      await expect(journal.locator('[data-kind="assign"]')).toContainText('Пётр, повар')
    } finally {
      await other.close()
    }
  } finally {
    await closeOrder(request, order.id)
  }
})
