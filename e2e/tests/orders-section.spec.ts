import { expect, test } from '@playwright/test'

import { ADMIN, CREDENTIALS, RESTAURANT_MANAGER, loginToTracker, login } from './helpers'

/**
 * РАЗДЕЛ «ЗАКАЗЫ» И ИСТОРИЯ БЕЗ ОКНА.
 *
 * Проверки идут по ЖИВОМУ стенду: раздел режется правами и считает цифры по
 * выборке, а и то и другое — состояние сервера. Мок показал бы, что экран умеет
 * рисовать, и промолчал бы о том, что видит управляющий.
 */

test.describe('Раздел «Заказы»', () => {
  test('администратор видит раздел, цифры и список', async ({ page }) => {
    await login(page, ADMIN)
    await page.goto('/cms/orders')

    await expect(page.getByTestId('cms-orders')).toBeVisible({ timeout: 25_000 })
    await expect(page.getByTestId('orders-numbers')).toBeVisible()

    // Четыре числа по выборке — каждое названо, а не «просто есть».
    for (const key of ['orders', 'revenue', 'cancelled', 'speed']) {
      await expect(page.getByTestId(`orders-number-${key}`)).toBeVisible()
    }
    await expect(page.getByTestId('orders-list').getByTestId(/^orders-row-/).first()).toBeVisible({
      timeout: 20_000,
    })
  })

  test('цифры меняются вместе с фильтром, а не остаются от всей выборки', async ({ page }) => {
    await login(page, ADMIN)
    await page.goto('/cms/orders')
    await expect(page.getByTestId('orders-number-orders')).toBeVisible({ timeout: 25_000 })

    const before = Number((await page.getByTestId('orders-number-orders').innerText()).replace(/\D/g, ''))
    expect(before, 'на стенде нет заказов — проверять нечего').toBeGreaterThan(0)

    // Сужаем по заведению: первое в списке, кроме «все заведения».
    await page.getByTestId('orders-filter-venue').click()
    await page.locator('[role="option"], li[role="menuitem"]').nth(1).click()

    await expect
      .poll(
        async () =>
          Number((await page.getByTestId('orders-number-orders').innerText()).replace(/\D/g, '')),
        { timeout: 15_000, message: 'цифры не изменились после фильтра — считаются не по выборке' },
      )
      .toBeLessThan(before)

    // И фильтр уехал в адрес — ссылку можно послать коллеге.
    expect(page.url()).toContain('point=')
  })

  test('управляющий видит раздел и только свои заведения', async ({ page }) => {
    await login(page, RESTAURANT_MANAGER)
    await page.goto('/cms/orders')
    await expect(page.getByTestId('cms-orders')).toBeVisible({ timeout: 25_000 })

    // В фильтре заведений — ровно его собственные.
    await page.getByTestId('orders-filter-venue').click()
    const options = page.locator('[role="option"], li[role="menuitem"]')
    const count = await options.count()
    expect(count, 'управляющему предложили чужие заведения').toBeLessThanOrEqual(2)
  })

  test('линейному пункта меню нет вовсе', async ({ page }) => {
    await loginToTracker(page, CREDENTIALS)
    await page.goto('/tracker')
    await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 25_000 })

    // Ни одной ссылки на раздел: не «есть и отказывает», а нет совсем.
    await expect(page.locator('a[href*="/cms/orders"]')).toHaveCount(0)
  })
})

test.describe('История доски', () => {
  test('над историей стоят цифры выборки, а не сводка смены', async ({ page }) => {
    await loginToTracker(page, CREDENTIALS)
    await page.goto('/tracker')
    await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 25_000 })
    /*
      Ждём КАРТОЧКУ, а не каркас доски: `tracker-board` появляется до ответа
      сервера, и проверка плиток срабатывала раньше, чем приходили числа.
      Замер: в пробе счётчики читались нулями, а ответ доски печатался строкой
      ниже — то есть тест мерил пустой экран, а не отсутствие плиток.
    */
    await page.getByTestId(/^tracker-order-/).first().waitFor({ timeout: 25_000 })

    // На активной доске — сводка смены с «Новых».
    await expect(page.getByTestId('tracker-tile-done')).toBeVisible()
    await expect(page.getByTestId('tracker-tile-new')).toBeVisible()

    await page.getByTestId('tracker-history-tab').click()

    // На истории — четыре числа по выборке, и плиток «Новых»/«В работе» нет.
    await expect(page.getByTestId('orders-numbers')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('tracker-tile-new')).toHaveCount(0)
  })

  test('история листается кнопкой и не повторяет записи', async ({ page }) => {
    await loginToTracker(page, CREDENTIALS)
    await page.goto('/tracker')
    await page.getByTestId('tracker-history-tab').click()
    await expect(page.getByTestId('orders-numbers')).toBeVisible({ timeout: 25_000 })
    await page.getByTestId(/^tracker-order-/).first().waitFor({ timeout: 25_000 })

    const cards = page.getByTestId(/^tracker-order-/)
    const before = await cards.count()
    expect(before, 'история пуста — листать нечего').toBeGreaterThan(0)

    const more = page.getByTestId('tracker-history-more')
    await expect(more, 'кнопки «показать ещё» нет, хотя записей больше страницы').toBeVisible()
    await more.click()

    await expect.poll(async () => cards.count(), { timeout: 20_000 }).toBeGreaterThan(before)

    // Ни одного повтора: номера уникальны.
    const numbers = await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-testid')),
    )
    expect(new Set(numbers).size, 'листание повторило карточки').toBe(numbers.length)
  })
})

test.describe('Из аналитики — в заказы', () => {
  /*
    ПЕРЕНОС СРЕЗА ПРОВЕРЯЕТСЯ ПО АДРЕСУ, А НЕ ПО ВИДУ КНОПКИ.

    Кнопка, которая ведёт в раздел, но теряет период, хуже отсутствующей:
    человек уверен, что смотрит те же сутки, а видит все. Проверка ловит ровно
    это — и поймала: на пресете (а он стоит по умолчанию) экран не шлёт дат
    вовсе, и ссылка собиралась без периода.

    Переносятся только период и заведение: остальные разрезы аналитики
    (устройство, язык, способ входа) в заказах не живут, и подменять их на
    «примерно то же» хуже, чем не переносить.
  */
  test('«показать эти заказы» уносит период в раздел', async ({ page }) => {
    await login(page, ADMIN)
    await page.getByTestId('cms-nav-analytics').click()
    await expect(page.getByTestId('cms-analytics')).toBeVisible({ timeout: 25_000 })

    await page.getByTestId('analytics-view-orders').click()
    await expect(page.getByTestId('analytics-drilldown')).toBeVisible({ timeout: 20_000 })

    const toOrders = page.getByTestId('analytics-to-orders')
    await expect(toOrders, 'из разбора заявок нет хода в раздел «Заказы»').toBeVisible()
    // Ждём, пока кнопка оживёт: до прихода сводки период неизвестен, и ход
    // намеренно неактивен — нажать его раньше значит уйти без периода.
    await expect(toOrders, 'кнопка так и не ожила — период не приехал').toBeEnabled({
      timeout: 20_000,
    })
    await toOrders.click()

    await expect(page).toHaveURL(/\/cms\/orders/, { timeout: 20_000 })
    const address = new URL(page.url())
    expect(
      address.searchParams.get('since'),
      'период не доехал: раздел откроется по всей истории, а человек ждёт свои сутки',
    ).toBeTruthy()
    expect(address.searchParams.get('until')).toBeTruthy()

    await expect(page.getByTestId('cms-orders')).toBeVisible({ timeout: 25_000 })
    await expect(page.getByTestId('orders-numbers')).toBeVisible()
  })
})
