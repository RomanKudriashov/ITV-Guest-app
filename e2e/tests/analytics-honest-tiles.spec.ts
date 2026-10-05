import { expect, test } from './fixtures'

import { ADMIN, signInToCms } from './helpers'

/**
 * АНАЛИТИКА ГОВОРИТ, ЧТО ПОКАЗЫВАЕТ И НА КАКОЙ МОМЕНТ (партия 31, INV-05 QA).
 *
 * Верхняя «Выручка» показывала сумму с начислениями (gross) — подпись теперь
 * та же; у среднего чека назван делитель; виден момент актуальности и есть
 * «Обновить» — открытая страница больше не стоит молча на старых цифрах.
 */

test('плитки названы по числу, видно «обновлено» и «Обновить» перезапрашивает', async ({ page }) => {
  await signInToCms(page, ADMIN)
  await page.goto('/cms/analytics')
  await expect(page.getByTestId('analytics-summary-card-revenue')).toContainText('Выручка с начислениями', {
    timeout: 20_000,
  })
  await expect(page.getByTestId('analytics-summary-card-avg_check')).toContainText('неотменённым заказам с ценой')
  const updated = page.getByTestId('analytics-updated-at')
  await expect(updated).toContainText(/Обновлено в \d{2}:\d{2}/)

  const again = page.waitForRequest((r) => r.url().includes('/cms/analytics/summary'))
  await page.getByTestId('analytics-refresh').click()
  await again
  await expect(page.getByTestId('analytics-refresh')).toBeEnabled({ timeout: 20_000 })
  await expect(updated).toContainText(/Обновлено в \d{2}:\d{2}/)
})
