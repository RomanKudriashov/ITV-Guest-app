import { expect, test } from './fixtures'

import { guestPage } from './brandGuest'

/**
 * СЕССИЯ ГОСТЯ НЕ ТЕРЯЕТСЯ ОТ ОБРЫВА СЕТИ (партия 25).
 *
 * При подъёме сессии из хранилища ЛЮБАЯ ошибка запроса стирала токен: обрыв
 * Wi-Fi, прерванный переходом запрос, сбой сервера. Гость оказывался на входе
 * и вводил номер заново. Нашлось сторожем ширины экранов: переход сразу после
 * смены языка обрывал подъём сессии — и гостя выбрасывало.
 *
 * Правило: токен стирается, только если сервер ответил «такой сессии нет».
 */

const TOKEN_KEY = 'itv.guest.token'

test('обрыв сети при подъёме сессии не выбрасывает гостя', async ({ browser }) => {
  const page = await guestPage(browser, { width: 390 })
  const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)
  expect(token).toBeTruthy()

  // Сеть «упала» ровно на запросе сессии.
  await page.route('**/guest/session', (route) => route.abort('internetdisconnected'))
  await page.reload()
  await page.waitForTimeout(2_000)
  expect(await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY), 'токен стёрт обрывом сети').toBe(token)

  // Сеть вернулась — гость там же, где был, без повторного входа.
  await page.unroute('**/guest/session')
  await page.reload()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
  await page.context().close()
})

test('сессию, которой нет на сервере, гость всё так же покидает', async ({ browser }) => {
  const page = await guestPage(browser, { width: 390 })
  await page.evaluate((key) => localStorage.setItem(key, 'not-a-real-token'), TOKEN_KEY)
  await page.reload()
  await expect(page.getByTestId('guest-room-input'), 'с отвергнутым токеном гость не на входе').toBeVisible({
    timeout: 20_000,
  })
  expect(await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)).toBeNull()
  await page.context().close()
})
