import { expect, test } from '@playwright/test'

import { DEMO_ROOM, openCart } from './helpers'

/**
 * Тот же заказ, но на телефоне (390px). Десктопная витрина не должна была
 * тронуть мобильный контур: остаётся нижняя навигация, плавающий бар корзины и
 * корзина отдельным экраном — не рельс и не колонка. Один сценарий на узкой
 * ширине страхует ровно от того, что дефолтная ширина Playwright (десктоп) не
 * проверяет.
 */

test.use({ viewport: { width: 390, height: 844 } })

test('телефон: полный заказ через нижнюю навигацию и бар корзины', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.goto('/')

  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 15_000 })

  // К блюдам гость идёт ЧЕРЕЗ заведение: плоского меню отеля больше нет,
  // и путь теста совпадает с путём живого гостя — плитка на главной.
  await page.getByTestId('guest-home-tile-kitchen').click()
  await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 15_000 })

  // Салат без обязательных модификаторов — добавляется прямо из списка.
  await page.getByTestId('guest-qty-plus-caesar').click()

  // На телефоне заказ виден плавающим баром — корзины-колонки здесь нет.
  await expect(page.getByTestId('guest-cart-bar')).toBeVisible({ timeout: 15_000 })
  await openCart(page)

  // Корзина — отдельный экран, а не колонка рядом с каталогом.
  await expect(page.getByTestId('guest-cart')).toBeVisible()
  await page.getByTestId('guest-place-order').click()

  await expect(page.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
  const orderId = page.url().split('/orders/')[1]?.split('?')[0]
  expect(orderId, 'id заказа должен быть в адресе').toBeTruthy()
})
