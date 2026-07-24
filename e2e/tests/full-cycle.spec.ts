import { expect, test, type Page } from '@playwright/test'

import { apiToken, CREDENTIALS, DEMO_ROOM, moveOrderStatus, openCart } from './helpers'

/**
 * Замкнутый цикл среза «еда», как он выглядит в жизни:
 * гость на своём телефоне оформляет заказ → он в реальном времени появляется
 * на доске кухни → повар принимает и ведёт по статусам → гость видит это у
 * себя, не перезагружая страницу.
 *
 * Два независимых контекста браузера — это принципиально: гость и повар
 * должны быть разными сессиями с разными токенами, как оно и есть на объекте.
 * Ни одна страница здесь не перезагружается: всё, что меняется, приходит по
 * WebSocket.
 */

async function guestPlacesOrder(page: Page): Promise<{ number: string; url: string }> {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/')

  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  // После входа гость на главной; для заказа уходим в меню нижней навигацией.
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('guest-nav-menu').click()
  await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 15_000 })

  // Салат без обязательных модификаторов — добавляется прямо из списка.
  await page.getByTestId('guest-qty-plus-caesar').click()
  await openCart(page)
  await page.getByTestId('guest-place-order').click()

  await expect(page.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
  const numberText = await page.getByTestId('guest-order-number').innerText()
  const number = numberText.match(/\d+/)?.[0] ?? ''
  expect(number, 'номер заявки должен быть виден гостю').toBeTruthy()

  await page.getByTestId('guest-track-order').click()
  await expect(page.getByTestId('guest-order-timeline')).toBeVisible()

  return { number, url: page.url() }
}

async function staffOpensBoard(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(CREDENTIALS.email)
  await page.getByTestId('login-password').fill(CREDENTIALS.password)
  await page.getByTestId('login-submit').click()
  // Дожидаемся, пока вход реально завершится: перейти на /tracker раньше —
  // значит попасть на RequireAuth без токена и вернуться на логин.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })

  await page.goto('/tracker')
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })
}

test.describe('Замкнутый цикл: гость → кухня → гость', () => {
  test('заказ доезжает до доски, повар ведёт его, гость видит статусы вживую', async ({
    browser,
  }) => {
    const guestContext = await browser.newContext()
    const staffContext = await browser.newContext()
    const guest = await guestContext.newPage()
    const staff = await staffContext.newPage()

    try {
      // Кухня открыта ЗАРАНЕЕ — иначе мы бы проверяли не realtime, а загрузку.
      await staffOpensBoard(staff)

      const order = await guestPlacesOrder(guest)
      const card = staff.getByTestId(`tracker-order-${order.number}`)

      // 1. Заказ приезжает на доску сам, без перезагрузки.
      await expect(card).toBeVisible({ timeout: 20_000 })
      await expect(card).toContainText(DEMO_ROOM)

      // 2. Повар принимает — у гостя статус меняется вживую.
      await staff.getByTestId(`tracker-accept-${order.number}`).click()
      await expect(guest.getByTestId('guest-order-status')).toContainText(/Принят/i, {
        timeout: 20_000,
      })

      // 3. И дальше по статусам.
      await staff.getByTestId(`tracker-status-${order.number}-preparing`).click()
      await expect(guest.getByTestId('guest-order-status')).toContainText(/Готовится/i, {
        timeout: 20_000,
      })
      // Отмена гостем на «Готовится» уже закрыта — кнопка обязана исчезнуть.
      await expect(guest.getByTestId('guest-cancel-order')).toBeHidden({ timeout: 15_000 })

      await staff.getByTestId(`tracker-status-${order.number}-on_the_way`).click()
      await expect(guest.getByTestId('guest-order-status')).toContainText(/В пути/i, {
        timeout: 20_000,
      })

      // 4. Завершение — заказ уходит с активной доски в историю.
      await staff.getByTestId(`tracker-status-${order.number}-done`).click()
      await expect(guest.getByTestId('guest-order-status')).toContainText(/Доставлено/i, {
        timeout: 20_000,
      })
      await expect(card).toBeHidden({ timeout: 20_000 })

      await staff.getByTestId('tracker-history-tab').click()
      await expect(staff.getByTestId(`tracker-order-${order.number}`)).toBeVisible({
        timeout: 15_000,
      })
    } finally {
      await guestContext.close()
      await staffContext.close()
    }
  })

  test('прямая ссылка открывает завершённый заказ, которого нет на активной доске', async ({
    browser,
    request,
  }) => {
    const guestContext = await browser.newContext()
    const guest = await guestContext.newPage()

    try {
      const order = await guestPlacesOrder(guest)
      const orderId = order.url.split('/orders/')[1]?.split('?')[0] as string

      const staffToken = await apiToken(request)
      await moveOrderStatus(request, staffToken, orderId, 'done')

      // «Холодный» переход: новая сессия, доска ещё не загружена, а заказ уже
      // терминальный — на вкладке «В работе» его нет. Раньше это упиралось в
      // «заказ не найден на доске».
      const staffContext = await browser.newContext()
      const staff = await staffContext.newPage()
      try {
        await staffOpensBoard(staff)
        await staff.goto(`/tracker/order/${orderId}`)

        const detail = staff.getByTestId('tracker-order-detail')
        await expect(detail).toBeVisible({ timeout: 20_000 })
        await expect(detail).toContainText(order.number)
        await expect(detail).toContainText(/Доставлено/i)
      } finally {
        await staffContext.close()
      }
    } finally {
      await guestContext.close()
    }
  })

  test('повар не видит доску чужой точки', async ({ page }) => {
    await staffOpensBoard(page)

    // Повар привязан только к кухне: в переключателе точек бара быть не должно.
    const selector = page.getByTestId('tracker-point-select')
    if (await selector.isVisible().catch(() => false)) {
      await expect(selector).not.toContainText(/бар/i)
    }
    await expect(page.getByTestId('tracker-board')).toBeVisible()
  })
})
