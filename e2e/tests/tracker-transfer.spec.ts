import { expect, test } from './fixtures'

import { API, HOTEL, CREDENTIALS, MAID, closeOrder, placeKitchenOrder, signInToTracker } from './helpers'

/**
 * ПЕРЕНОС ЗАКАЗА МЕЖДУ ДОСКАМИ ЧЕРЕЗ ИНТЕРФЕЙС (партия 48).
 *
 * Повар — старший смены кухни: «Передать на другую точку» в меню карточки,
 * точка и причина обязательны. Карточка уходит с доски кухни сразу, без
 * перезагрузки; на доске хозслужбы заказ — в начальном статусе и ничей; гость
 * видит «Передали в «…»».
 */
test('старший смены передаёт заказ в хозслужбу — кухня теряет карточку, хозслужба получает, гость видит', async ({
  page,
  browser,
  request,
}) => {
  const order = await placeKitchenOrder(request)
  try {
    await signInToTracker(page, CREDENTIALS)
    await page.goto('/tracker?point=kitchen')
    const card = page.getByTestId(`tracker-order-${order.number}`)
    await expect(card).toBeVisible({ timeout: 25_000 })

    await page.getByTestId(`tracker-more-${order.number}`).click()
    await page.getByTestId(`tracker-transfer-${order.number}`).click()
    await expect(page.getByTestId('tracker-transfer-confirm')).toBeDisabled()
    await page.getByTestId('tracker-transfer-point').click()
    await page.getByTestId('tracker-transfer-point-housekeeping').click()
    await page.getByTestId('tracker-transfer-reason').fill('гость просил уборку, а не еду')
    await page.getByTestId('tracker-transfer-confirm').click()

    // Доска кухни теряет карточку сама — без перезагрузки.
    await expect(card).toHaveCount(0, { timeout: 5_000 })

    // Хозслужба: заказ у неё, ничей.
    const other = await browser.newContext()
    const maidPage = await other.newPage()
    try {
      await signInToTracker(maidPage, MAID)
      await maidPage.goto(`/tracker/order/${order.id}`)
      const detail = maidPage.getByTestId('tracker-order-detail')
      await expect(detail).toBeVisible({ timeout: 25_000 })
      await expect(maidPage.getByTestId(`tracker-accept-${order.number}`)).toBeVisible()
      await expect(maidPage.getByTestId('tracker-order-journal').locator('[data-kind="transfer"]')).toContainText(
        /Передан из/,
      )
    } finally {
      await other.close()
    }

    // Гость: «Передали в «…»».
    const guest = await request.get(`${API}/api/guest/order/${order.id}`, {
      headers: { Authorization: `Bearer ${order.guestToken}`, 'X-Hotel-Subdomain': HOTEL },
    })
    expect((await guest.json()).transfer?.to, 'гость не видит, куда передали').toBeTruthy()
  } finally {
    await closeOrder(request, order.id)
  }
})
