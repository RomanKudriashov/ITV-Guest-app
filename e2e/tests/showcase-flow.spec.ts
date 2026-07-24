import { expect, test, type Page } from '@playwright/test'

import { API, apiHeaders, apiToken, DEMO_ROOM, openCart } from './helpers'

/**
 * Витрина главной (C4): три уровня иерархии.
 *  1. Главная — bento-плитки сервисов.
 *  2. Список заведений группы (когда их больше порога).
 *  3. Каталог заведения (тот же эталонный каталог, суженный по точке).
 *
 * Стенд общий и последовательный (workers: 1), поэтому тест, меняющий порог
 * группировки отеля, ОБЯЗАН вернуть его обратно — иначе поедут другие тесты.
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
  await expect(page.getByTestId('guest-home-bento')).toBeVisible({ timeout: 15_000 })
}

test.describe('Витрина главной', () => {
  test('главная → плитка ресторана → каталог заведения → заказ', async ({ page }) => {
    await enterAsGuest(page)

    // Уровень 3: плитка заведения ведёт в ЕГО каталог.
    await page.getByTestId('guest-home-tile-kitchen').click()
    await expect(page).toHaveURL(/\/venue\/kitchen/)
    await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 15_000 })

    // Каталог заведения работает как обычный: кладём позицию в корзину.
    await page.getByTestId('guest-item-ribeye').click()
    const sheet = page.getByTestId('guest-item-sheet')
    await expect(sheet).toBeVisible()
    await page.getByTestId('guest-add-to-cart').click()
    await expect(sheet).toBeHidden()
    // Заказ зарегистрирован: колонка корзины на десктопе, бар — на мобиле.
    await openCart(page)
  })

  test('много заведений → плитка категории → список → каталог', async ({ page, request }) => {
    const token = await apiToken(request)

    // Сворачиваем всё в категории: порог 0 делает ресторан-плитку группой.
    const setThreshold = async (value: number) => {
      const resp = await request.put(`${API}/api/cms/showcase`, {
        headers: apiHeaders(token),
        data: { group_threshold: value },
      })
      expect(resp.ok()).toBeTruthy()
    }

    await setThreshold(0)
    try {
      await enterAsGuest(page)

      // Уровень 1 → 2: плитка-категория «Рестораны» ведёт на список заведений.
      await page.getByTestId('guest-home-tile-restaurants').click()
      await expect(page).toHaveURL(/\/category\/restaurants/)
      await expect(page.getByTestId('guest-venue-list')).toBeVisible({ timeout: 15_000 })

      // Уровень 2 → 3: карточка заведения ведёт в его каталог.
      await page.getByTestId('guest-venue-kitchen').click()
      await expect(page).toHaveURL(/\/venue\/kitchen/)
      await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 15_000 })
    } finally {
      await setThreshold(3) // вернуть общий стенд в исходное состояние
    }
  })
})
