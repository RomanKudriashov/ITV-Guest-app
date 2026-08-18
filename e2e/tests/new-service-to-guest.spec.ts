import { expect, test, type Page } from '@playwright/test'

import { DEMO_ROOM, login, unique } from './helpers'

/**
 * ПРИЁМКА: раздел, созданный в интерфейсе, доходит до гостя.
 *
 * Весь путь кликами, без единого запроса мимо экрана — в этом и смысл. Два
 * теста, которые «покрывали категории», собирали фикстуру через API и сами
 * присылали то, чего экран не присылал: `service_id` в теле и отдельный
 * `PUT /categories/{id}/routes`. Оба зелёные, а оператор в это время заводил
 * раздел, который не появлялся ни в меню заведения, ни у гостя.
 *
 * Здесь нет ни одного вызова API. Если исполнитель перестанет проставляться
 * сам — тест краснеет ровно там, где больно: гость не видит раздел.
 */

/** Завести заведение выбранного типа через диалог «+ добавить сервис». */
async function createService(page: Page, typeLabel: RegExp, name: string): Promise<void> {
  await page.goto('/cms/services')
  await expect(page.getByTestId('cms-services')).toBeVisible()
  await page.getByTestId('services-add').click()

  await page.getByTestId('service-create-type').click()
  await page.getByRole('option', { name: typeLabel }).first().click()
  await page.getByTestId('service-create-name').fill(name)
  await page.getByTestId('service-create-submit').click()

  await expect(page.getByTestId('cms-service-workspace')).toBeVisible({ timeout: 20_000 })
}

/** Вход гостем по номеру — на витрину. */
async function enterAsGuest(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home-bento')).toBeVisible({ timeout: 20_000 })
}

for (const { label, typeLabel } of [
  { label: 'Свой', typeLabel: /^Свой/ },
  { label: 'Ресторан', typeLabel: /^Ресторан/ },
]) {
  test(`«${label}»: новое заведение → раздел → позиция → гость видит всё три`, async ({
    page,
    context,
  }) => {
    const serviceName = unique(`Приёмка ${label}`)
    const categoryName = unique('Раздел')
    const itemName = unique('Позиция')

    await login(page)
    await createService(page, typeLabel, serviceName)

    /* ── Раздел: «Добавить раздел» → название → «Сохранить» ─────────────── */
    await page.getByTestId('add-category-button').click()
    await page.getByTestId('category-title-input').fill(categoryName)
    await page.getByTestId('category-save-button').click()
    // Сохранение подтверждено экраном, а не таймаутом.
    await expect(page.getByText('Категория сохранена')).toBeVisible({ timeout: 15_000 })
    // И редактор ДЕЙСТВИТЕЛЬНО считает себя чистым.
    //
    // Погасшая кнопка «Сохранить» тут не годится в признак: она гаснет и на
    // время самого запроса (`isPending`), то есть проходит мгновенно и ничего
    // не доказывает. Чистоту показывает подпись: пока дерево не перечиталось,
    // редактор считает себя грязным, сторож несохранённого перехватывает
    // «Назад» — и переход теряется молча (отдельный дефект, см. отчёт).
    await expect(page.getByText('Все изменения сохранены')).toBeVisible({ timeout: 15_000 })

    /* ── Возврат: «Назад» ведёт в ТО ЖЕ заведение, и раздел в нём есть ──── */
    await page.getByTestId('category-back-button').click()
    await expect(page.getByTestId('cms-service-workspace')).toBeVisible({ timeout: 20_000 })
    await expect(
      page.getByTestId('menu-category-list').getByText(categoryName),
      'раздел не вернулся в меню заведения, где его завели',
    ).toBeVisible({ timeout: 20_000 })

    /* ── Позиция в этот раздел ──────────────────────────────────────────── */
    await page.getByTestId('add-item-button').click()
    await expect(page).toHaveURL(/\/cms\/menu\/items\/new/)
    await page.getByTestId('item-title-input').fill(itemName)
    await page.getByTestId('item-price-input').fill('1500')
    await page.getByTestId('item-save-button').click()
    await expect(page.getByText('Блюдо сохранено')).toBeVisible({ timeout: 15_000 })

    /* ── ГОСТЬ. Это и есть приёмка ──────────────────────────────────────── */
    const guest = await context.newPage()
    await enterAsGuest(guest)

    const tile = guest
      .locator('[data-testid^="guest-home-tile-"]')
      .filter({ hasText: serviceName })
    await expect(
      tile,
      'заведения нет на витрине: у его раздела не проставился исполнитель',
    ).toHaveCount(1, { timeout: 20_000 })

    await tile.click()
    await expect(guest.getByTestId('guest-menu')).toBeVisible({ timeout: 20_000 })
    await expect(
      guest.getByText(categoryName).first(),
      'гость не видит раздел, заведённый в интерфейсе',
    ).toBeVisible({ timeout: 20_000 })
    await expect(
      guest.getByText(itemName).first(),
      'гость не видит позицию из нового раздела',
    ).toBeVisible({ timeout: 20_000 })
  })
}
