import { expect, test } from './fixtures'

import { signInToCms } from './helpers'

/**
 * ПУСТЫЕ «ЗАКАЗЫ» У СТАРШЕГО РЕСЕПШЕНА — ПОДПИСЬ ГОВОРИТ ПРАВДУ (партия 31, QA п.14).
 *
 * Факт: область старшего ресепшена — одна точка «Ресепшен», и заказов на ней
 * нет (те, что ресепшен оформляет за гостя, исполняют другие заведения).
 * Фильтр прав верный — врала подпись «все заведения сразу».
 */

const SENIOR_RECEPTION = { email: 'manager.reception@crystal.local', password: 'chef12345' }

test('старший ресепшен: пустой список называет его заведения, а не «все сразу»', async ({ page }) => {
  await signInToCms(page, SENIOR_RECEPTION)
  await page.goto('/cms/orders')
  const main = page.locator('main')
  await expect(main).toContainText('заказы ваших заведений: Ресепшен', { timeout: 20_000 })
  await expect(main).not.toContainText('все заведения сразу')
})
