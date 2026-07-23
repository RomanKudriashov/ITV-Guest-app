import { expect, test } from '@playwright/test'

import {
  apiDelete,
  apiGet,
  apiToken,
  findItemByTitle,
  login,
  unique,
  type CmsItem,
} from './helpers'

/**
 * Главный E2E-сценарий: блюдо создаётся и редактируется через UI.
 *
 * Проверяем не «нарисовалось ли», а результат на бэкенде: после каждого
 * сохранения читаем объект через API. Скриншот зелёной формы ничего не
 * доказывает, если данные не доехали.
 */
test.describe('CMS: редактор блюда', () => {
  const created: string[] = []

  test.afterAll(async ({ request }) => {
    const token = await apiToken(request)
    for (const id of created) {
      await apiDelete(request, token, `/api/cms/items/${id}`)
    }
  })

  test('создание блюда со всеми полями и последующее редактирование', async ({
    page,
    request,
  }) => {
    const title = unique('Утка по-пекински')
    const token = await apiToken(request)

    await login(page)

    // --- Выбираем категорию и заходим в создание блюда ------------------
    await expect(page.getByTestId('menu-category-list')).toBeVisible()
    await page.getByTestId('category-item-hot').click()
    await expect(page.getByTestId('item-list')).toBeVisible()
    await page.getByTestId('add-item-button').click()
    await expect(page).toHaveURL(/\/cms\/menu\/items\/new/)

    // --- Заполняем форму -----------------------------------------------
    await page.getByTestId('item-title-input').fill(title)
    await page.getByTestId('item-price-input').fill('2450')
    await page.getByTestId('item-flag-chef_choice').click()
    await page.getByTestId('item-flag-spicy').click()
    await page.getByTestId('item-allergen-soy').click()

    // Пока форма не сохранена — видно, что есть несохранённые изменения.
    await expect(page.getByTestId('item-dirty-badge')).toBeVisible()

    await page.getByTestId('item-save-button').click()

    // После создания экран переходит в режим редактирования: у блюда
    // появился id, без которого некуда вешать фото и модификаторы.
    await expect(page).toHaveURL(/\/cms\/menu\/items\/[0-9a-f-]{36}/, { timeout: 15_000 })
    await expect(page.getByTestId('item-dirty-badge')).toBeHidden()

    const item = await findItemByTitle(request, token, title)
    expect(item, 'блюдо должно появиться в каталоге').toBeTruthy()
    created.push(item!.id)

    // Цена введена в рублях, а храниться обязана в копейках.
    expect(item!.price).toBe(245000)
    expect(item!.flags.sort()).toEqual(['chef_choice', 'spicy'])

    // --- Добавляем обязательную группу модификаторов --------------------
    await page.getByTestId('modifier-group-add').click()
    await page.getByTestId('modifier-group-title-0').fill('Соус')
    await page.getByTestId('modifier-group-required-0').check()

    await page.getByTestId('modifier-option-add-0').click()
    await page.getByTestId('modifier-option-0-0-title').fill('Хойсин')

    await page.getByTestId('modifier-option-add-0').click()
    await page.getByTestId('modifier-option-0-1-title').fill('Острый')
    await page.getByTestId('modifier-option-0-1-price').fill('120')

    await page.getByTestId('item-save-button').click()
    await expect(page.getByTestId('item-dirty-badge')).toBeHidden({ timeout: 15_000 })

    const withModifiers = await apiGet<CmsItem>(request, token, `/api/cms/items/${item!.id}`)
    expect(withModifiers.modifier_groups).toHaveLength(1)

    const group = withModifiers.modifier_groups![0]
    expect(group.is_required).toBe(true)
    // Обязательная группа с одиночным выбором обязана требовать ровно один
    // вариант — это правило нормализует сервер, а не форма.
    expect(group.selection).toBe('single')
    expect(group.options).toHaveLength(2)
    expect(group.options.map((option) => option.price_delta).sort((a, b) => a - b)).toEqual([
      0, 12000,
    ])

    // --- Редактируем: меняем цену и снимаем флаг -------------------------
    await page.getByTestId('item-price-input').fill('2600')
    await page.getByTestId('item-flag-spicy').click()
    await page.getByTestId('item-save-button').click()
    await expect(page.getByTestId('item-dirty-badge')).toBeHidden({ timeout: 15_000 })

    const edited = await apiGet<CmsItem>(request, token, `/api/cms/items/${item!.id}`)
    expect(edited.price).toBe(260000)
    expect(edited.flags).toEqual(['chef_choice'])

    // --- Изменения переживают перезагрузку страницы ----------------------
    await page.reload()
    await expect(page.getByTestId('item-price-input')).toHaveValue(/2600/)
    await expect(page.getByTestId('modifier-group-title-0')).toHaveValue('Соус')
  })

  test('блюдо из CMS доезжает до гостевого меню', async ({ page, request }) => {
    const title = unique('Плов')
    const token = await apiToken(request)

    await login(page)
    await page.getByTestId('category-item-hot').click()
    await page.getByTestId('add-item-button').click()

    await page.getByTestId('item-title-input').fill(title)
    await page.getByTestId('item-price-input').fill('890')
    await page.getByTestId('item-save-button').click()
    await expect(page).toHaveURL(/\/cms\/menu\/items\/[0-9a-f-]{36}/, { timeout: 15_000 })

    const item = await findItemByTitle(request, token, title)
    expect(item).toBeTruthy()
    created.push(item!.id)

    // Гостевая витрина — конечный потребитель CMS. Заводим сессию гостя и
    // убеждаемся, что новое блюдо в меню есть.
    const sessionResponse = await request.post(
      `${process.env.E2E_API_URL ?? 'http://localhost:8010'}/api/guest/session`,
      { data: { room_number: '201' }, headers: { 'X-Hotel-Subdomain': 'crystal' } },
    )
    expect(sessionResponse.ok()).toBeTruthy()
    const guestToken = (await sessionResponse.json()).token

    const menuResponse = await request.get(
      `${process.env.E2E_API_URL ?? 'http://localhost:8010'}/api/guest/menu`,
      {
        headers: {
          Authorization: `Bearer ${guestToken}`,
          'X-Hotel-Subdomain': 'crystal',
          'Accept-Language': 'ru',
        },
      },
    )
    const menu = await menuResponse.json()
    const titles = menu.categories.flatMap((category: { items: { title: string }[] }) =>
      category.items.map((menuItem) => menuItem.title),
    )
    expect(titles).toContain(title)
  })

  test('стоп-лист и выключение блюда переключаются из списка', async ({ page, request }) => {
    const token = await apiToken(request)

    await login(page)
    await page.getByTestId('category-item-salads').click()
    await expect(page.getByTestId('item-row-caesar')).toBeVisible()

    // Именно click(), а не uncheck(): переключатель управляется данными с
    // сервера и меняет состояние только после ответа, а uncheck() требует
    // мгновенной смены и падает на этой задержке.
    await page.getByTestId('item-stock-caesar').click()
    await expect
      .poll(async () => (await findItemByTitle(request, token, 'Цезарь'))?.in_stock)
      .toBe(false)

    await page.getByTestId('item-stock-caesar').click()
    await expect
      .poll(async () => (await findItemByTitle(request, token, 'Цезарь'))?.in_stock)
      .toBe(true)
  })
})
