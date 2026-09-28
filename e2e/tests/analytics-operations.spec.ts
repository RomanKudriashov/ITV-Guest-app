import { type Page, type Route } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN } from './helpers'

/**
 * АНАЛИТИКА → «ОПЕРАЦИИ» И «ТРАФИК»: ЧИСЛА ИЗ ОТВЕТА, А НЕ «NaN».
 *
 * Внешний аудит стенда (E2E-001): при ответе 200 с заполненным `by_point`
 * вкладка рисовала «NaN», «не число %» и «Нет данных по операциям». Вкладка
 * читала `rows`, `avg_*` и `escalations` числом — полей, которых сервер не
 * слал никогда. «Трафик» болел тем же. Ни типы (TypeScript верит объявлению),
 * ни сторож контракта (сверяет семейство формы и только буквальные пути) этого
 * не видели.
 *
 * Здесь два слоя:
 *   • ЖИВОЙ ответ — поля, которые читает вкладка, в нём есть, и на экране
 *     нет ни одного «NaN»;
 *   • ПОДМЕНЁННЫЙ ответ — несколько заведений, нули, `null` и пустой список:
 *     всё, что сервер законно может прислать, рисуется числом или прочерком.
 */

const GARBAGE = /NaN|не число|not a number|Infinity/i

async function openAnalytics(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(ADMIN.email)
  await page.getByTestId('login-password').fill(ADMIN.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  await page.getByTestId('cms-nav-analytics').click()
  await expect(page.getByTestId('cms-analytics')).toBeVisible({ timeout: 20_000 })
}

/** Открыть вкладку и дождаться именно её ответа. */
async function openTab(page: Page, tab: 'operations' | 'traffic') {
  const response = page.waitForResponse((r) => r.url().includes(`/analytics/${tab}`))
  await page.getByTestId(`analytics-tab-${tab}`).click()
  const body = await (await response).json()
  return body
}

function fulfillOperations(body: unknown) {
  return (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
}

test.describe('Аналитика: «Операции» и «Трафик» показывают ответ', () => {
  test('живой ответ: поля вкладки на месте, на экране нет NaN', async ({ page }) => {
    await openAnalytics(page)
    await page.getByTestId('analytics-filter-preset-month').click()
    const body = await openTab(page, 'operations')

    // Форма, которую читает вкладка, — сверкой с ЖИВЫМ ответом.
    expect(body.totals, 'итогов нет — плитки нечем наполнить').toBeTruthy()
    for (const key of ['orders', 'cancel_rate', 'off_hours_rate', 'avg_reaction_seconds', 'avg_fulfil_seconds']) {
      expect(key in body.totals, `totals.${key}`).toBeTruthy()
    }
    expect(Array.isArray(body.by_point), 'by_point — список').toBeTruthy()
    expect(typeof body.escalations?.fired, 'escalations.fired — число').toBe('number')
    expect(body.by_point.length, 'демо-история за месяц пуста — проверка ничего не проверяет').toBeGreaterThan(0)

    await expect(page.getByTestId('analytics-operations-table')).toBeVisible()
    await expect(page.locator('[data-testid^="analytics-operations-row-"]')).toHaveCount(body.by_point.length)
    await expect(page.getByTestId('cms-analytics')).not.toContainText(GARBAGE)

    await openTab(page, 'traffic')
    await expect(page.getByTestId('cms-analytics')).not.toContainText(GARBAGE)
  })

  test('несколько заведений, нули и null — числа и прочерки, без NaN', async ({ page }) => {
    await page.route(
      '**/analytics/operations?*',
      fulfillOperations({
        totals: {
          orders: 7, completed: 4, cancelled: 1, cancel_rate: 0.1429, off_hours_rate: 0,
          avg_reaction_seconds: 84, avg_fulfil_seconds: 131,
        },
        by_point: [
          { key: 'p-kitchen', label: 'Кухня-тест', orders: 5, completed: 3, cancelled: 1, cancel_rate: 0.2,
            avg_reaction_seconds: 84, avg_fulfil_seconds: 131, escalations: 3 },
          // Ни одного принятия: среднего нет — и это «—», а не «0 s».
          { key: 'p-spa', label: 'СПА-тест', orders: 2, completed: 1, cancelled: 0, cancel_rate: 0,
            avg_reaction_seconds: null, avg_fulfil_seconds: null, escalations: 0 },
        ],
        escalations: { fired: 3 },
      }),
    )
    await openAnalytics(page)
    await openTab(page, 'operations')

    const kitchen = page.getByTestId('analytics-operations-row-p-kitchen')
    await expect(kitchen).toContainText('Кухня-тест')
    await expect(kitchen).toContainText('1m 24s')
    await expect(kitchen).toContainText('20')
    const spa = page.getByTestId('analytics-operations-row-p-spa')
    await expect(spa).toContainText('СПА-тест')
    await expect(spa).toContainText('—')
    await expect(page.getByTestId('analytics-operations-escalations')).toContainText('3')
    await expect(page.getByTestId('analytics-operations-avg-reaction')).toContainText('1m 24s')
    await expect(page.getByTestId('cms-analytics')).not.toContainText(GARBAGE)
  })

  test('пустой период — «нет данных» и прочерки, без NaN', async ({ page }) => {
    await page.route(
      '**/analytics/operations?*',
      fulfillOperations({
        totals: {
          orders: 0, completed: 0, cancelled: 0, cancel_rate: 0, off_hours_rate: 0,
          avg_reaction_seconds: null, avg_fulfil_seconds: null,
        },
        by_point: [],
        escalations: { fired: 0 },
      }),
    )
    await openAnalytics(page)
    await openTab(page, 'operations')

    await expect(page.getByTestId('analytics-operations-empty')).toBeVisible()
    await expect(page.getByTestId('analytics-operations-avg-reaction')).toContainText('—')
    await expect(page.getByTestId('analytics-operations-escalations')).toContainText('0')
    await expect(page.getByTestId('cms-analytics')).not.toContainText(GARBAGE)
  })
})
