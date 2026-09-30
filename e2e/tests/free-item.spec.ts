import { expect, test } from './fixtures'

import { ADMIN, API, HOTEL, apiToken, unique } from './helpers'
import { guestPage } from './brandGuest'
import { setLanguage } from '../fixtures/appState'

/**
 * НУЛЕВАЯ ЦЕНА — «БЕСПЛАТНО», И ТАКАЯ КОРЗИНА ОФОРМЛЯЕТСЯ (партия 25).
 *
 * Позиция с ценой 0 (комплимент, вода, газета) показывалась «0 ₽» — на
 * карточке, в корзине, в итоге. Теперь «Бесплатно» на языке гостя, а корзина
 * из одной бесплатной позиции доходит до оформленного заказа.
 *
 * Условие явное: бесплатная позиция заводится в «Горячее» кухни и удаляется.
 */

const FREE = { ru: 'Бесплатно', en: 'Free', ar: 'مجانًا', zh: '免费' } as const

test('бесплатная позиция: «Бесплатно» на 4 языках, корзина из неё оформляется', async ({ browser, request }) => {
  test.setTimeout(180_000)
  const token = await apiToken(request, ADMIN)
  const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }
  const categories = await (await request.get(`${API}/api/cms/categories?type=product`, { headers })).json()
  const hot = (categories.items ?? categories).find((c: { code: string }) => c.code === 'hot')
  const title = unique('Комплимент от шефа')
  const created = await request.post(`${API}/api/cms/items`, {
    data: { category_id: hot.id, type: 'product', title: { ru: title }, price: 0 },
    headers,
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const item = await created.json()

  try {
    const page = await guestPage(browser, { width: 390 })
    for (const language of ['ru', 'en', 'ar', 'zh'] as const) {
      await setLanguage(page, language)
      await page.goto('/venue/kitchen')
      const card = page.getByTestId(`guest-item-${item.code}`)
      await expect(card, `карточки бесплатной позиции нет (${language})`).toBeVisible({ timeout: 20_000 })
      await expect(card).toContainText(FREE[language])
      await expect(card).not.toContainText(/(^|\D)0\s?₽/)
    }

    await setLanguage(page, 'ru')
    await page.goto('/venue/kitchen')
    await page.getByTestId(`guest-qty-plus-${item.code}`).click()
    await page.getByTestId('guest-cart-button').first().click()
    const line = page.getByTestId(`guest-cart-line-${item.code}`)
    await expect(line).toBeVisible({ timeout: 20_000 })
    await expect(line, 'строка корзины — не «Бесплатно»').toContainText(FREE.ru)
    const cart = page.getByTestId('guest-cart').first()
    await expect(cart, 'в корзине где-то «0 ₽»').not.toContainText(/(^|\D)0\s?₽/)

    await page.getByTestId('guest-place-order').click()
    await expect(page.getByTestId('guest-order-status'), 'корзина из бесплатной позиции не оформилась').toBeVisible({
      timeout: 20_000,
    })
    const orderId = page.url().split('/orders/')[1]?.split(/[?#]/)[0]
    const guestToken = await page.evaluate(() => localStorage.getItem('itv.guest.token'))
    if (orderId && guestToken) {
      await request.post(`${API}/api/v1/guest/order/${orderId}/cancel`, {
        headers: { Authorization: `Bearer ${guestToken}`, 'X-Hotel-Subdomain': HOTEL },
        data: {},
      })
    }
    await page.context().close()
  } finally {
    await request.delete(`${API}/api/cms/items/${item.id}`, { headers })
  }
})
