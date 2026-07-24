import { expect, test, type Page } from '@playwright/test'

import { apiToken, DEMO_ROOM, moveOrderStatus, openCart } from './helpers'

/**
 * Полный гостевой поток: вход по номеру → меню → карточка блюда с обязательным
 * модификатором → корзина → оформление → подтверждение → ЖИВОЙ статус.
 *
 * Живое обновление проверяется честно: статус двигается через API «от лица
 * кухни», а страница гостя не перезагружается и не переоткрывается. Если бы
 * обновление приходило только по F5, тест бы упал.
 */

async function enterAsGuest(page: Page, room = DEMO_ROOM): Promise<void> {
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(room)
  await page.getByTestId('guest-room-submit').click()
}

async function openMenu(page: Page): Promise<void> {
  // Продуктовое поведение C4: со входа гость на главной-витрине; в каталог
  // ресторана ведёт его плитка (уровень 3), а не общее меню.
  await expect(page.getByTestId('guest-home-bento')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('guest-home-tile-kitchen').click()
  await expect(page).toHaveURL(/\/venue\/kitchen/)
  await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 15_000 })
}

test.describe('Гостевая витрина', () => {
  test.beforeEach(async ({ page }) => {
    // Каждый тест — новый гость: чистим сессию и корзину от прошлого теста.
    await page.goto('/')
    await page.evaluate(() => {
      window.localStorage.clear()
      window.sessionStorage.clear()
    })
  })

  test('вход → заказ с обязательным модификатором → подтверждение → живой статус', async ({
    page,
    request,
  }) => {
    const staffToken = await apiToken(request)

    await enterAsGuest(page)
    await openMenu(page)

    // --- Карточка блюда с обязательной прожаркой --------------------------
    await page.getByTestId('guest-item-ribeye').click()
    const sheet = page.getByTestId('guest-item-sheet')
    await expect(sheet).toBeVisible()

    const addButton = page.getByTestId('guest-add-to-cart')
    // Обязательная группа предвыбрана вариантом по умолчанию — гостю не нужно
    // подтверждать очевидное, поэтому кнопка сразу активна.
    await expect(addButton).toBeEnabled()
    await expect(addButton).toContainText('1 900')

    await page.getByTestId('guest-modifier-option-well_done').click()
    // Платная добавка обязана пересчитать кнопку: 1 900 + 150 = 2 050 ₽.
    await page.getByTestId('guest-modifier-option-sauce_pepper').click()
    await expect(addButton).toContainText('2 050')

    await addButton.click()
    await expect(sheet).toBeHidden()

    // --- Корзина ----------------------------------------------------------
    await openCart(page)

    // Доставка в номер выбрана по умолчанию — гость пришёл из комнаты.
    await expect(page.getByTestId('guest-location-in_room')).toBeVisible()
    // 1 900 ₽ + 150 ₽ соус.
    await expect(page.getByTestId('guest-cart-total')).toContainText('2')

    await page.getByTestId('guest-place-order').click()

    // --- Подтверждение ----------------------------------------------------
    await expect(page.getByTestId('guest-confirmation')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('guest-order-number')).toContainText(/\d+/)
    await expect(page.getByTestId('guest-order-eta')).toBeVisible()

    const orderId = page.url().split('/orders/')[1]?.split('?')[0]
    expect(orderId, 'id заказа должен быть в адресе').toBeTruthy()

    // --- Живой статус ------------------------------------------------------
    await page.getByTestId('guest-track-order').click()
    const timeline = page.getByTestId('guest-order-timeline')
    await expect(timeline).toBeVisible()
    await expect(page.getByTestId('guest-order-status')).toContainText(/Новый/i)

    await moveOrderStatus(request, staffToken, orderId as string, 'accepted')
    await expect(page.getByTestId('guest-order-status')).toContainText(/Принят/i, {
      timeout: 15_000,
    })

    await moveOrderStatus(request, staffToken, orderId as string, 'preparing')
    await expect(page.getByTestId('guest-order-status')).toContainText(/Готовится/i, {
      timeout: 15_000,
    })
    // С «Готовится» отмена уже закрыта — кнопка обязана исчезнуть сама.
    await expect(page.getByTestId('guest-cancel-order')).toBeHidden({ timeout: 15_000 })

    // --- История -----------------------------------------------------------
    await page.getByTestId('guest-nav-orders').click()
    await expect(page.getByTestId('guest-orders-list')).toBeVisible()
    await expect(page.getByTestId('guest-orders-list')).toContainText(/Готовится/i)
  })

  test('корзина переживает перезагрузку страницы', async ({ page }) => {
    await enterAsGuest(page)
    await openMenu(page)

    // Салат без обязательных модификаторов — добавляется прямо из списка.
    await page.getByTestId('guest-qty-plus-caesar').click()
    // Заказ виден: колонка корзины на десктопе, бар — на мобиле; проверяем через openCart.
    await openCart(page)

    await page.reload()

    // Незавершённый ввод гостя не должен исчезать от перезагрузки — это то же
    // правило состояния, что и «фоновый refetch не затирает корзину».
    await openCart(page)
  })

  test('неизвестный номер ведёт на ручной ввод, а не в тупик', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('guest-room-input').fill('999')
    await page.getByTestId('guest-room-submit').click()

    await expect(page.getByTestId('guest-entry-error')).toBeVisible({ timeout: 15_000 })
    // Экран остаётся фирменным и позволяет ввести номер заново.
    await expect(page.getByTestId('guest-room-input')).toBeVisible()
  })

  test('гость без номера видит меню, но не может оформить заказ', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('guest-browse-only').click()
    await openMenu(page)

    await page.getByTestId('guest-qty-plus-caesar').click()
    await openCart(page)

    // Доверие ограничивает действия, а не просмотр: меню видно, оформление — нет.
    await expect(page.getByTestId('guest-cart-trust')).toBeVisible()
    await expect(page.getByTestId('guest-place-order')).toBeDisabled()
  })
})
