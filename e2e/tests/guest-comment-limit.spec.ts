import { expect, test } from './fixtures'

import { DEMO_ROOM } from './helpers'

/**
 * КОММЕНТАРИЙ ГОСТЯ: ВИДИМЫЙ ПРЕДЕЛ И ПРЕДУПРЕЖДЕНИЕ ОБ ОБРЕЗКЕ (партия 31, DEV-10 QA).
 *
 * QA: `maxlength=300` молча обрезал вставку, счётчика не было, эмодзи
 * считались за два знака. Теперь «N/300», символ — символ, обрезка названа.
 */

test('вставка длиннее 300 — обрезана с предупреждением; эмодзи — один знак', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
  await page.goto('/venue/concierge')
  await page.getByTestId('guest-service-laundry-service').click()

  const field = page.getByTestId('guest-request-comment')
  const counter = page.getByTestId('guest-request-comment-counter')
  await expect(counter).toHaveText('0/300')

  await field.fill('😀'.repeat(10))
  await expect(counter).toHaveText('10/300')

  await field.fill('а'.repeat(400))
  await expect(field).toHaveValue('а'.repeat(300))
  await expect(counter).toContainText('обрезан до 300')
  await expect(counter).toContainText('300/300')
})

/*
  УКУС (партия 62-F): набранное до прихода полной карточки услуги не стирается.

  Форма рисуется по короткой записи из списка, полная карточка (с полями
  заявки) приходит отдельным запросом. Ключ черновика включал коды полей, и
  пришедшая позже карточка пересоздавала черновик целиком — комментарий
  пропадал. На медленной машине так падала проверка выше: поле оказывалось
  пустым. Причина — `RequestOrderForm.tsx` (ключ `useDraftState`); та же беда
  была у блюда (`ProductOrderForm.tsx`) и корзины (`CartPage.tsx`).
*/
test('комментарий, набранный до прихода полной карточки, остаётся', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })

  let held = 0
  await page.route('**/guest/item/**', async (route) => {
    held += 1
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    await route.continue()
  })
  await page.goto('/venue/concierge')
  await page.getByTestId('guest-service-laundry-service').click()
  const field = page.getByTestId('guest-request-comment')
  await field.fill('а'.repeat(400))
  await expect.poll(() => held, { message: 'полную карточку не запросили — проверка не о том' }).toBeGreaterThan(0)
  await page.waitForResponse('**/guest/item/**', { timeout: 15_000 })
  await page.waitForTimeout(500)
  await expect(field).toHaveValue('а'.repeat(300))
  await expect(page.getByTestId('guest-request-comment-counter')).toContainText('300/300')
})
