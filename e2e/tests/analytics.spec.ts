import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

import { ADMIN } from './helpers'

/**
 * CMS «Аналитика»: дашборд читает предагрегаты, фильтр применяется, drill-down
 * доходит до конкретных заявок, экспорт считается фоном и завершается.
 *
 * Заходим старшим кухни (chef): дашборд скоупится его точкой — этого достаточно,
 * чтобы проверить весь путь до данных.
 */

async function openAnalytics(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(ADMIN.email)
  await page.getByTestId('login-password').fill(ADMIN.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  await page.getByTestId('cms-nav-analytics').click()
  await expect(page.getByTestId('cms-analytics')).toBeVisible({ timeout: 20_000 })
}

test.describe('CMS Аналитика', () => {
  test('дашборд, фильтр, drill-down и экспорт', async ({ page }) => {
    await openAnalytics(page)

    // --- Период: месяц → карточки-итоги наполнены -------------------------
    //
    // Ждём ОТВЕТ по новому периоду, а не появление карточек: `analytics-summary`
    // нарисован всегда, ещё до клика по пресету, и ожидание его видимости
    // проходило мгновенно. Тест читал карточку, в которой могло стоять число
    // прошлого периода, и не мог отличить «месяц применился» от «клик никуда
    // не дошёл». Подписка ставится ДО клика — быстрый ответ иначе пропустим.
    const monthly = page.waitForResponse(
      (r) => r.url().includes('/analytics/summary') && r.url().includes('preset=month'),
    )
    await page.getByTestId('analytics-filter-preset-month').click()
    expect((await monthly).ok(), 'сводка за месяц не пришла').toBeTruthy()
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

    // --- Экспорт: считается фоном И ДОХОДИТ ДО ФАЙЛА -----------------------
    //
    // Раньше здесь кончалась проверка на строке статуса «Готово · N строк» —
    // и она была честной ровно наполовину: срез действительно считался, а файл
    // не скачивался вовсе. Скачивание шло голой ссылкой, без токена, сервер
    // отвечал 401, и браузер сохранял тело отказа как «download.json».
    // Статус при этом рапортовал успех. Теперь ждём САМ ФАЙЛ.
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByTestId('analytics-export-button').click()
    await page.getByTestId('analytics-export-format-csv').click()
    const status = page.getByTestId('analytics-export-status')
    await expect(status).toBeVisible({ timeout: 15_000 })

    const download = await downloadPromise
    // Имя говорит, что это: отель, тип выгрузки, период.
    expect(
      download.suggestedFilename(),
      'имя файла должно называть отель, тип выгрузки и период',
    ).toMatch(/^crystal-\w+-.+\.csv$/)
    // И это НЕ тело отказа: файл непустой и начинается заголовками CSV.
    const path = await download.path()
    expect(path, 'файл не сохранился').toBeTruthy()
    const body = readFileSync(path!, 'utf8')
    expect(body.length, 'скачался пустой файл').toBeGreaterThan(0)
    expect(body, 'вместо CSV скачалось тело ошибки').not.toContain('detail')

    await expect(status).toContainText(/\d/, { timeout: 30_000 })
    await expect(page.getByTestId('analytics-export-button')).toBeEnabled({ timeout: 30_000 })
  })

  test('сервер отказал на скачивании — это видно, а не выдано за успех', async ({ page }) => {
    await openAnalytics(page)

    // Срез считается как обычно, ломается ровно отдача файла.
    await page.route('**/analytics/export/*/download', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"detail":"relation does not exist"}',
      }),
    )

    let downloaded = false
    page.on('download', () => {
      downloaded = true
    })

    await page.getByTestId('analytics-export-button').click()
    await page.getByTestId('analytics-export-format-csv').click()

    // Отказ назван — и назван на СКАЧИВАНИИ, а не «ошибкой экспорта»: срез
    // посчитан, не доехал именно файл.
    await expect(page.getByTestId('analytics-export-status')).toHaveText(/скачал/i, {
      timeout: 45_000,
    })
    // И браузеру не подсунули тело ошибки под видом файла.
    expect(downloaded, 'сохранён файл, которого нет: это и был «download.json»').toBe(false)
  })
})
