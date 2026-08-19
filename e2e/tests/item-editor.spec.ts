import { expect, test } from '@playwright/test'

import {
  API,
  HOTEL,
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
    // С R4 меню живёт ВНУТРИ заведения: «меню какого ресторана» теперь имеет
    // ответ, и путь к блюду идёт через рабочее пространство сервиса.
    await openKitchenMenu(page, request)

    // --- Выбираем категорию и заходим в создание блюда ------------------
    await expect(page.getByTestId('menu-category-list')).toBeVisible()
    await page.getByTestId('category-item-hot').click()
    await expect(page.getByTestId('item-list')).toBeVisible()
    await page.getByTestId('add-item-button').click()
    await expect(page).toHaveURL(/\/cms\/menu\/items\/new/)

    // --- Заполняем форму -----------------------------------------------
    await page.getByTestId('item-title-input').fill(title)
    await page.getByTestId('item-price-input').fill('2450')
    // Данные карточки — из тенант-словарей (join): аллерген, маркер и
    // характеристика (пара название→значение).
    await page.getByTestId('item-allergen-soy').click()
    await page.getByTestId('item-marker-vegan').click()
    await page.getByTestId('characteristic-add').click()
    await page.getByTestId('characteristic-name-0').fill('Вкус')
    await page.getByTestId('characteristic-value-0').fill('Острый')

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
    const full = await apiGet<CmsItem>(request, token, `/api/cms/items/${item!.id}`)
    expect(full.allergen_ids).toHaveLength(1)
    expect(full.marker_ids).toHaveLength(1)
    expect(full.characteristics).toHaveLength(1)
    expect(full.characteristics![0].name.ru).toBe('Вкус')

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

    /*
      --- Редактируем: меняем цену и снимаем маркер ----------------------

      ЖДЁМ СОСТОЯНИЯ ФОРМЫ, А НЕ МЕТКИ «не сохранено».

      Здесь тест флейковал, и причина не в скорости, а в том, что ждали не то.

      Сохранение внутри себя сбрасывает `dirtyRef`, обнуляет `hydratedIdRef` и
      дожидается перечитывания позиции. Но РЕГИДРАТАЦИЯ формы — это эффект, он
      выполняется в следующем рендере, уже ПОСЛЕ того, как мутация разрешилась
      и метка погасла. Окно между «метка погасла» и «эффект отработал» и есть
      дыра: тест успевает напечатать 2600, эффект приезжает следом и возвращает
      в поле серверные 2450 (пропустить регидратацию он умеет только у грязной
      формы, а грязной она станет лишь в следующем рендере). Сохранялась
      старая цена, а тест читал её как «правка не доехала».

      Ждать здесь ответа сервера бесполезно: `GET` уходит ВНУТРИ мутации, то
      есть раньше, чем мы успеваем на него подписаться.

      Поэтому ждём того, что действительно требуется следующему шагу: поле
      держит новое значение И форма знает, что она грязная. С этого момента
      регидратация её не тронет — блокировка стоит в самом эффекте. Если
      поздняя регидратация всё же затёрла ввод, блок просто повторится.
    */
    const priceInput = page.getByTestId('item-price-input')
    await expect(async () => {
      await priceInput.fill('2600')
      // Проверки КОРОТКИЕ намеренно: смысл блока — переиграть регидратацию
      // новым вводом, а не пересидеть её. С длинным ожиданием первая же
      // попытка выбирала весь бюджет, стоя перед откатившимся полем.
      await expect(priceInput).toHaveValue('2600', { timeout: 1_500 })
      await expect(page.getByTestId('item-dirty-badge')).toBeVisible({ timeout: 1_500 })
    }).toPass({ timeout: 20_000 })

    await page.getByTestId('item-marker-vegan').click() // снять маркер

    // Вторая гонка: `GET` через API мог обогнать `PATCH` формы, и мы читали
    // позицию до записи. Подписываемся ДО нажатия — иначе снова опоздаем.
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes(`/cms/items/${item!.id}`) &&
        response.request().method() === 'PATCH',
      { timeout: 15_000 },
    )
    await page.getByTestId('item-save-button').click()
    expect((await saved).ok(), 'сохранение правки отклонено сервером').toBeTruthy()
    await expect(page.getByTestId('item-dirty-badge')).toBeHidden({ timeout: 15_000 })

    const edited = await apiGet<CmsItem>(request, token, `/api/cms/items/${item!.id}`)
    expect(edited.price).toBe(260000)
    expect(edited.marker_ids).toEqual([]) // маркер снят, аллерген остался
    expect(edited.allergen_ids).toHaveLength(1)

    // --- Изменения переживают перезагрузку страницы ----------------------
    await page.reload()
    await expect(page.getByTestId('item-price-input')).toHaveValue(/2600/)
    await expect(page.getByTestId('modifier-group-title-0')).toHaveValue('Соус')
  })

  test('блюдо из CMS доезжает до гостевого меню', async ({ page, request }) => {
    const title = unique('Плов')
    const token = await apiToken(request)

    await login(page)
    await openKitchenMenu(page, request)
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
      `${process.env.E2E_API_URL ?? 'http://localhost:8010'}/api/guest/catalog`,
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

    // Переключатель меняет состояние ОТНОСИТЕЛЬНО текущего, поэтому начальное
    // задаём сами: тест, предполагающий состояние вместо того, чтобы его
    // выставить, ломается от любого прерванного прогона до него.
    const caesar = await findItemByTitle(request, token, 'Цезарь')
    await request.post(`${API}/api/cms/items/${caesar!.id}/stock`, {
      data: { in_stock: true },
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })

    await login(page)
    await openKitchenMenu(page, request)
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

/**
 * Меню кухни «Панорама».
 *
 * С R4 меню — вкладка внутри заведения, а не стартовый экран CMS: раньше меню
 * отеля было одной кучей, и вопрос «меню какого ресторана» ответа не имел.
 */
async function openKitchenMenu(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
): Promise<void> {
  const token = await apiToken(request)
  const services = (await request
    .get(`${API}/api/cms/services`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    .then((r) => r.json())
      .then((page) => page.items)) as Array<{ id: string; code: string }>
  const kitchen = services.find((service) => service.code === 'kitchen')!
  await page.goto(`/cms/services/${kitchen.id}`)
  await expect(page.getByTestId('service-menu')).toBeVisible({ timeout: 20_000 })
}
