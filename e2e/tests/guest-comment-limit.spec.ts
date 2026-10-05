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
