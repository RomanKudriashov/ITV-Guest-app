import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, HOTEL, apiToken, signInToCms } from './helpers'
import { guestPage } from './brandGuest'
import { setLanguage } from '../fixtures/appState'

/**
 * ЦЕНА — ЗНАКОМ «₽» НА ЛЮБОМ ЯЗЫКЕ, ОДНИМ ФОРМАТОМ ДЛЯ ВИТРИНЫ И ПАНЕЛИ
 * (партия 25).
 *
 * `Intl` пишет знак рубля только в русской локали: гость на английском,
 * арабском, китайском видел «RUB 1,450». Формат один (`utils/money.ts`), и
 * знак там узкий на любом языке — проверяется на витрине (меню, корзина) и в
 * панели отеля (меню заведения).
 */

async function moneyText(page: Page): Promise<{ codes: string[]; signs: number }> {
  return page.evaluate(() => {
    const text = document.body.innerText
    return { codes: text.match(/\bRUB\b/g) ?? [], signs: (text.match(/₽/g) ?? []).length }
  })
}

for (const language of ['en', 'ar', 'zh'] as const) {
  test(`витрина: цены знаком ₽, а не кодом — ${language}`, async ({ browser }) => {
    const page = await guestPage(browser, { width: 390 })
    await setLanguage(page, language)
    await page.goto('/venue/kitchen')
    await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('guest-qty-plus-caesar').click()
    let money = await moneyText(page)
    expect(money.codes, `меню (${language}): код валюты вместо знака`).toEqual([])
    expect(money.signs, `меню (${language}): цен знаком нет`).toBeGreaterThan(3)

    await page.getByTestId('guest-cart-button').first().click()
    await expect(page.getByTestId('guest-cart-line-caesar')).toBeVisible({ timeout: 20_000 })
    money = await moneyText(page)
    expect(money.codes, `корзина (${language}): код валюты вместо знака`).toEqual([])
    expect(money.signs, `корзина (${language}): цен знаком нет`).toBeGreaterThan(0)
    await page.context().close()
  })
}

test('панель отеля по-английски: цены меню знаком ₽', async ({ page, request }) => {
  const token = await apiToken(request, ADMIN)
  const services = (
    await (
      await request.get(`${API}/api/cms/services`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
      })
    ).json()
  ).items as Array<{ id: string; code: string }>
  const kitchen = services.find((service) => service.code === 'kitchen')!

  await signInToCms(page, ADMIN)
  await page.goto(`/cms/services/${kitchen.id}`)
  await setLanguage(page, 'en')
  await expect(page.getByTestId('service-menu')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('category-item-hot').click()
  await expect(page.getByTestId('item-list')).toBeVisible()
  const money = await moneyText(page)
  expect(money.codes, 'панель: код валюты вместо знака').toEqual([])
  expect(money.signs, 'панель: цен знаком нет').toBeGreaterThan(0)
})
