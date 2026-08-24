import { expect, test, type Page } from '@playwright/test'

import { ADMIN } from './helpers'

/**
 * ДАШБОРД — ПУЛЬТ, А НЕ СПРАВКА (пункт 29).
 *
 * Экран показывал три плитки, две из которых меняются раз в месяц, и список
 * сервисов с «2 сотр. · 8 позиций». Ни одно из этих чисел не требовало
 * действия, хотя подпись обещала «что происходит сейчас».
 *
 * Ответ сервера подменяется: состояние «всё горит» и состояние «всё чисто»
 * живым путём не получить одновременно, а именно РАЗНИЦА между ними здесь и
 * проверяется. Правила скоупа проверены на бэкенде, где они и живут.
 */

async function login(page: Page) {
  await page.goto('/login')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/login')
  await page.getByTestId('login-email').fill(ADMIN.email)
  await page.getByTestId('login-password').fill(ADMIN.password)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/cms\//, { timeout: 30_000 })
}

const TODAY = {
  orders: 63,
  orders_delta: 0.8,
  revenue_minor: 6490000,
  revenue_delta: 0.65,
  avg_rating: 4.8,
  rating_delta: 0,
  live_guests: 3,
  median_minutes: 7,
  median_pickup_minutes: 2,
  done: 26,
  in_work: 4,
}

async function dashboard(
  page: Page,
  body: { attention?: unknown[]; today?: Record<string, unknown>; venues?: unknown[] },
): Promise<void> {
  await page.route('**/api/v1/cms/dashboard**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        scope: { all_points: true, points_count: 3 },
        attention: body.attention ?? [],
        today: { ...TODAY, ...(body.today ?? {}) },
        venues: body.venues ?? [],
      }),
    })
  })
}

test.describe('Дашборд: пульт', () => {
  test('УКУС: всё в порядке → одна строка, а не пять зелёных нулей', async ({ page }) => {
    /*
      Пять карточек с нулями читаются как список проблем, у которых сейчас
      значение ноль, и глаз перестаёт их различать: когда одна станет
      единицей, её не заметят.
    */
    await dashboard(page, { attention: [] })
    await login(page)
    await page.goto('/cms/dashboard')

    await expect(page.getByTestId('dashboard-all-clear')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('dashboard-attention')).toHaveCount(0)
    // Ни одной карточки-нуля: список пуст целиком, а не заполнен нулями.
    await expect(page.locator('[data-testid^="dashboard-attention-"]')).toHaveCount(0)
  })

  test('УКУС: просрочка есть → карточка с переходом на отфильтрованную доску', async ({
    page,
  }) => {
    await dashboard(page, {
      attention: [
        { code: 'overdue', severity: 'error', count: 5, route: '/tracker?overdue=1' },
      ],
    })
    await login(page)
    await page.goto('/cms/dashboard')

    const card = page.getByTestId('dashboard-attention-overdue')
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(card).toContainText('5')
    // Карточка объясняет, ЧЕМ это грозит, а не только называет число.
    await expect(card).toContainText(/ждёт дольше/i)
    await expect(page.getByTestId('dashboard-all-clear')).toHaveCount(0)

    await page.getByTestId('dashboard-go-overdue').click()
    // Переход «в трекер вообще» заставлял бы искать те же заказы глазами.
    await expect(page).toHaveURL(/overdue=1/)
  })

  test('УКУС: данных нет → прочерк, а не ноль', async ({ page }) => {
    /*
      «Обычно занимает 0 минут» экран показал бы как «делаем мгновенно», то
      есть соврал бы в самую лестную сторону.
    */
    await dashboard(page, {
      today: { median_minutes: null, avg_rating: null, rating_delta: null, revenue_minor: null },
    })
    await login(page)
    await page.goto('/cms/dashboard')

    await expect(page.getByTestId('dashboard-speed')).toContainText('—', { timeout: 20_000 })
    await expect(page.getByTestId('dashboard-rating')).toContainText('—')
    await expect(page.getByTestId('dashboard-revenue')).toContainText('—')
    // А посчитанное остаётся числом.
    await expect(page.getByTestId('dashboard-orders')).toContainText('63')
  })

  test('день показан РАЗНИЦЕЙ ко вчерашнему, а не голым числом', async ({ page }) => {
    await dashboard(page, {})
    await login(page)
    await page.goto('/cms/dashboard')

    const orders = page.getByTestId('dashboard-orders')
    await expect(orders).toContainText('63', { timeout: 20_000 })
    await expect(orders).toContainText('+80%')
    await expect(orders).toContainText(/ко вчера/i)
    // Ноль-дельта — это «столько же», и её показывают: молчание читалось бы
    // как «сравнить не с чем», а это другое.
    await expect(page.getByTestId('dashboard-rating')).toContainText('0%')
  })

  test('строка заведения говорит, как там дела, и ведёт на его доску', async ({ page }) => {
    await dashboard(page, {
      venues: [
        {
          code: 'kitchen',
          title: { ru: 'Панорама' },
          in_work: 4,
          new: 2,
          overdue: 12,
          median_minutes: 8,
          route: '/tracker?point=kitchen',
        },
        {
          code: 'bar',
          title: { ru: 'Лобби-бар' },
          in_work: 0,
          new: 0,
          overdue: 0,
          median_minutes: null,
          route: '/tracker?point=bar',
        },
      ],
    })
    await login(page)
    await page.goto('/cms/dashboard')

    const venue = page.getByTestId('dashboard-venue-kitchen')
    await expect(venue).toBeVisible({ timeout: 20_000 })
    // «Как там дела», а не «сколько там строк меню»: справочных «2 сотр. ·
    // 8 позиций» на пульте больше нет.
    await expect(venue).toContainText('4')
    await expect(venue).toContainText('12')
    await expect(venue).not.toContainText(/сотр\./i)

    await venue.click()
    await expect(page).toHaveURL(/point=kitchen/)
  })
})
