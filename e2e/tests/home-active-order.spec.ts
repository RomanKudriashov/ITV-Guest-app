import { expect, test, type Page } from '@playwright/test'

import { apiToken, DEMO_ROOM, moveOrderStatus } from './helpers'

/**
 * Стартовая (A3+ шаг 4): полоса активного заказа. Гость оформляет заказ → на
 * стартовой видит полосу со статусом и временем подачи → статус меняют «от лица
 * кухни» → полоса обновляется ВЖИВУЮ (реконсиляция снимком по WS), без
 * перезагрузки.
 */

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

async function openMenu(page: Page): Promise<void> {
  const restaurant = page.getByTestId('guest-service-restaurant')
  if (await restaurant.isVisible().catch(() => false)) {
    await restaurant.click()
  } else {
    await page.getByTestId('guest-nav-menu').click()
  }
  await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 15_000 })
}

test('полоса активного заказа: статус, время подачи, живое обновление', async ({ page, request }) => {
  const staff = await apiToken(request)

  await enterAsGuest(page)
  await openMenu(page)

  // Салат без обязательных модификаторов — добавляем из списка и оформляем.
  await page.getByTestId('guest-qty-plus-caesar').click()
  await expect(page.getByTestId('guest-cart-bar')).toBeVisible()
  await page.getByTestId('guest-cart-bar').click()
  await expect(page.getByTestId('guest-cart')).toBeVisible()
  await page.getByTestId('guest-place-order').click()
  await expect(page.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
  const orderId = page.url().split('/orders/')[1]?.split('?')[0]
  expect(orderId, 'id заказа в адресе').toBeTruthy()

  // На стартовой — полоса активного заказа со статусом и временем подачи.
  await page.getByTestId('guest-nav-home').click()
  await expect(page.getByTestId('guest-active-order-strip')).toBeVisible({ timeout: 15_000 })
  const row = page.getByTestId(`guest-active-order-${orderId}`)
  await expect(row).toBeVisible()
  await expect(row).toContainText(/Новый/i)
  await expect(row).toContainText(/к \d{1,2}:\d{2}/) // «подадут к 20:40»

  // Кухня двигает статус — полоса обновляется вживую, без перезагрузки.
  await moveOrderStatus(request, staff, orderId as string, 'accepted')
  await expect(row).toContainText(/Принят/i, { timeout: 15_000 })

  // Быстрые действия на стартовой — из настроек отеля (дефолт: разделы + чат).
  await expect(page.getByTestId('guest-quick-actions')).toBeVisible()
  await expect(page.getByTestId('guest-quick-action-chat')).toBeVisible()
})
