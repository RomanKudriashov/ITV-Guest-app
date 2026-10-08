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
      // В панели заказа: под ней доска хозслужбы, и перенесённая карточка
      // наверху колонки несёт ту же «Принять» — без сужения их две.
      await expect(detail.getByTestId(`tracker-accept-${order.number}`)).toBeVisible()
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

/**
 * УКУС (партия 48, часть p-f): доска кухни отпускает карточку ПО ОТВЕТУ
 * переноса, а не по перечитыванию доски или снимку сокета. Под нагрузкой части
 * перечитывание длинной доски кухни шло 6 с, и карточка висела дольше 5 с.
 * Здесь медленную доску делает сама проверка: после «Передать» перечитывание
 * держится 8 с, снимки сокета придержаны.
 */
test('УКУС: карточка уходит с доски по ответу переноса, не дожидаясь перечитывания', async ({ page, request }) => {
  const order = await placeKitchenOrder(request)
  let live = true
  try {
    await page.routeWebSocket('**/ws/**', (ws) => {
      const server = ws.connectToServer()
      server.onMessage((message) => {
        if (live) ws.send(message)
      })
    })
    await page.route('**/api/v1/tracker/orders**', async (route) => {
      if (!live) await new Promise((resolve) => setTimeout(resolve, 8_000))
      await route.continue().catch(() => undefined)
    })

    await signInToTracker(page, CREDENTIALS)
    await page.goto('/tracker?point=kitchen')
    const card = page.getByTestId(`tracker-order-${order.number}`)
    await expect(card).toBeVisible({ timeout: 25_000 })

    await page.getByTestId(`tracker-more-${order.number}`).click()
    await page.getByTestId(`tracker-transfer-${order.number}`).click()
    await page.getByTestId('tracker-transfer-point').click()
    await page.getByTestId('tracker-transfer-point-housekeeping').click()
    await page.getByTestId('tracker-transfer-reason').fill('проверка: доска медленная')
    live = false
    await page.getByTestId('tracker-transfer-confirm').click()

    await expect(card, 'карточка ждёт перечитывания доски, а не ответа переноса').toHaveCount(0, {
      timeout: 3_000,
    })
  } finally {
    live = true
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await closeOrder(request, order.id)
  }
})
