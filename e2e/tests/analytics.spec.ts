import { expect, test, type Page } from '@playwright/test'

import { CREDENTIALS } from './helpers'

/**
 * CMS «Аналитика»: дашборд читает предагрегаты, фильтр применяется, drill-down
 * доходит до конкретных заявок, экспорт считается фоном и завершается.
 *
 * Заходим старшим кухни (chef): дашборд скоупится его точкой — этого достаточно,
 * чтобы проверить весь путь до данных.
 */

async function openAnalytics(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(CREDENTIALS.email)
  await page.getByTestId('login-password').fill(CREDENTIALS.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  await page.getByTestId('cms-analytics-nav').click()
  await expect(page.getByTestId('cms-analytics')).toBeVisible({ timeout: 20_000 })
}

test.describe('CMS Аналитика', () => {
  test('дашборд, фильтр, drill-down и экспорт', async ({ page }) => {
    await openAnalytics(page)

    // --- Период: месяц → карточки-итоги наполнены -------------------------
    await page.getByTestId('analytics-filter-preset-month').click()
    await expect(page.getByTestId('analytics-summary')).toBeVisible({ timeout: 15_000 })
    const orders = page.getByTestId('analytics-summary-card-orders')
    await expect(orders).toBeVisible()
    // В карточке заказов — число (у демо-истории их десятки).
    await expect(orders).toContainText(/\d/)

    // --- Разбивка присутствует -------------------------------------------
    await expect(page.getByTestId('analytics-breakdown-table')).toBeVisible({ timeout: 15_000 })

    // --- Drill-down до конкретных заявок ---------------------------------
    await page.getByTestId('analytics-view-orders').click()
    await expect(page.getByTestId('analytics-drilldown')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-testid^="analytics-drilldown-row-"]').first()).toBeVisible({
      timeout: 15_000,
    })

    // --- Экспорт: считается фоном и доходит до готового --------------------
    // Кнопка открывает меню форматов; выбираем CSV.
    await page.getByTestId('analytics-export-button').click()
    await page.getByTestId('analytics-export-format-csv').click()
    const status = page.getByTestId('analytics-export-status')
    await expect(status).toBeVisible({ timeout: 15_000 })
    // Готово: строка статуса показывает число строк (readyShort), а кнопка
    // снова активна — экспорт не блокировал страницу.
    await expect(status).toContainText(/\d/, { timeout: 30_000 })
    await expect(page.getByTestId('analytics-export-button')).toBeEnabled({ timeout: 30_000 })
  })
})
