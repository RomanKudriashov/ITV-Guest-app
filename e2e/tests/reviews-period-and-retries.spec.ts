import { type Page, type Request } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN } from './helpers'

/**
 * «ОТЗЫВЫ»: ПЕРЕВЁРНУТЫЙ ПЕРИОД И ПОВТОРЫ (ADM-001 внешнего аудита).
 *
 * Было: «С» позже «По» — уходили список и сводка, каждый получал 422 и
 * повторялся, итого четыре отказа в консоли; на экране — общее «Не удалось
 * загрузить отзывов», причина сервера («начало периода позже конца») терялась.
 *
 * Три вещи, и каждая — отдельно:
 *   • перевёрнутый период ловится ДО запроса: поле подсвечено, запросов нет;
 *   • 4xx не повторяется (правило одно на приложение, `api/retry.ts`), и на
 *     экране — причина, а не «не удалось»;
 *   • сбой 5xx по-прежнему повторяется — правило не выключило повторы вовсе.
 */

async function openReviews(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(ADMIN.email)
  await page.getByTestId('login-password').fill(ADMIN.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  await page.getByTestId('cms-nav-reviews').click()
  await expect(page.getByTestId('cms-reviews')).toBeVisible({ timeout: 20_000 })
}

/** Запросы списка и сводки отзывов (не аналитики). */
function reviewsCalls(page: Page): Request[] {
  const calls: Request[] = []
  page.on('request', (request) => {
    if (/\/api\/(v1\/)?cms\/reviews(\/summary)?(\?|$)/.test(request.url())) calls.push(request)
  })
  return calls
}

test.describe('Отзывы: период и повторы', () => {
  test('перевёрнутый период — поле подсвечено, запросы не уходят', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await openReviews(page)
    await expect(page.getByTestId('reviews-count')).toBeVisible()
    // Первичная загрузка отработала — считаем только то, что уйдёт ПОСЛЕ ввода.
    await page.waitForLoadState('networkidle')
    const calls = reviewsCalls(page)

    await page.getByTestId('reviews-filter-since').fill('2026-09-24')
    await page.getByTestId('reviews-filter-until').fill('2026-09-01')

    await expect(page.getByTestId('reviews-bad-range')).toBeVisible()
    await expect(page.getByTestId('reviews-filter-since')).toHaveAttribute('aria-invalid', 'true')
    await page.waitForTimeout(1500)
    // После ввода одного «С» законный запрос уходит — период ещё не перевёрнут.
    // Запрещён именно запрос с «С» позже «По».
    const reversed = calls.filter((c) => {
      const url = new URL(c.url())
      const from = url.searchParams.get('date_from')
      const to = url.searchParams.get('date_to')
      return Boolean(from && to && from > to)
    })
    expect(reversed.map((c) => c.url()), 'с перевёрнутым периодом запросы уходить не должны').toEqual([])
    expect(consoleErrors.filter((text) => text.includes('422'))).toEqual([])

    // Поправили период — данные вернулись, подсветка ушла.
    await page.getByTestId('reviews-filter-until').fill('2026-09-30')
    await expect(page.getByTestId('reviews-bad-range')).toHaveCount(0)
    await expect(page.getByTestId('reviews-filter-since')).not.toHaveAttribute('aria-invalid', 'true')
    await expect
      .poll(() => calls.some((c) => new URL(c.url()).searchParams.get('date_to') === '2026-09-30'))
      .toBeTruthy()
  })

  test('отказ 422 не повторяется, и на экране причина, а не «не удалось»', async ({ page }) => {
    await page.route(/\/cms\/reviews(\?|$)/, (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Начало периода позже конца', code: 'bad_range', field: 'date_from' }),
      }),
    )
    const calls = reviewsCalls(page)
    await openReviews(page)

    await expect(page.getByTestId('state-refused')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('state-refused')).toContainText(/позже конца|after the end/)
    await expect(page.getByTestId('state-retry')).toHaveCount(0)
    await page.waitForTimeout(2500)
    const lists = calls.filter((c) => !c.url().includes('/summary'))
    expect(lists.length, '4xx повторён — повторы лечат только сбой').toBe(1)
  })

  test('сбой 500 по-прежнему повторяется один раз', async ({ page }) => {
    await page.route(/\/cms\/reviews(\?|$)/, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' }),
    )
    const calls = reviewsCalls(page)
    await openReviews(page)

    await expect(page.getByTestId('state-error')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('state-retry')).toBeVisible()
    const lists = calls.filter((c) => !c.url().includes('/summary'))
    expect(lists.length, 'сбой сервера должен повториться').toBe(2)
  })
})
