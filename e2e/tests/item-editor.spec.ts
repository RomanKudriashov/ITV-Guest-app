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

      Печатаем сразу после сохранения, ничего не выжидая, — и это ПРОВЕРКА, а
      не небрежность. Ровно в это окно приезжали два перечитывания позиции и
      затирали набранное; теперь ответ сервера применяется по полям и тронутое
      не трогает. Отдельные укусы на оба направления — в блоке
      «Редактор позиции: сохранение и одновременная правка».
    */
    await page.getByTestId('item-price-input').fill('2600')
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

/**
 * ОТВЕТ СЕРВЕРА НЕ ЗАТИРАЕТ НАБРАННОЕ ПОСЛЕ ОТПРАВКИ.
 *
 * Дефект, ради которого написан блок. После сохранения позиция перечитывается
 * ДВАЖДЫ: один раз от инвалидации по префиксу `['cms','items']` (ключ позиции
 * `['cms','items','detail',id]` попадает под него), второй — явным запросом
 * ключа. Оба ответа приезжают уже после того, как человек мог начать править,
 * и прежний код клал их поверх формы: набранное жило около полусекунды и
 * заменялось серверным. Сохранялось потом старое — правка не доезжала.
 *
 * Чинилось это дважды решением «грязную форму не трогаем целиком», и оба раза
 * упиралось в яму: либо форма оставалась грязной навсегда, либо правка уходила
 * на сервер, а на экране висела старая цифра. Поэтому здесь проверяются ОБА
 * направления, а не только то, ради которого правку затевали.
 */
test.describe('Редактор позиции: сохранение и одновременная правка', () => {
  const created: string[] = []

  test.afterAll(async ({ request }) => {
    const token = await apiToken(request)
    for (const id of created) await apiDelete(request, token, `/api/cms/items/${id}`)
  })

  /** Завести позицию через API и открыть её редактор. */
  async function openFreshItem(
    page: import('@playwright/test').Page,
    request: import('@playwright/test').APIRequestContext,
  ): Promise<{ id: string; title: string }> {
    const token = await apiToken(request)
    const title = unique('Слияние')
    await login(page)
    await openKitchenMenu(page, request)
    await page.getByTestId('category-item-hot').click()
    await page.getByTestId('add-item-button').click()
    await page.getByTestId('item-title-input').fill(title)
    await page.getByTestId('item-price-input').fill('2450')
    await page.getByTestId('item-save-button').click()
    await expect(page).toHaveURL(/\/cms\/menu\/items\/[0-9a-f-]{36}/, { timeout: 15_000 })
    const item = await findItemByTitle(request, token, title)
    expect(item, 'позиция должна появиться в каталоге').toBeTruthy()
    created.push(item!.id)
    return { id: item!.id, title }
  }

  test('набранное сразу после сохранения переживает ответ сервера', async ({
    page,
    request,
  }) => {
    const token = await apiToken(request)
    const { id } = await openFreshItem(page, request)

    /*
      Печатаем, ПОКА ЗАПИСЬ В ПОЛЁТЕ. Синхронизируемся по факту ухода `PATCH`,
      а не по паузе: пауза проверяла бы скорость машины, а нужен сценарий —
      человек правит, не дождавшись конца сохранения. Именно в это окно и
      приезжали оба перечитывания, затирая набранное.
    */
    const writeStarted = page.waitForRequest(
      (r) => r.url().includes(`/cms/items/${id}`) && r.method() === 'PATCH',
      { timeout: 15_000 },
    )
    await page.getByTestId('item-title-input').fill(unique('Слияние правка'))
    await page.getByTestId('item-save-button').click()
    await writeStarted
    await page.getByTestId('item-price-input').fill('2600')

    // Держим дольше, чем живут оба ответа: раньше значение откатывалось
    // примерно через полсекунды и больше не возвращалось.
    await page.waitForTimeout(4_000)
    await expect(
      page.getByTestId('item-price-input'),
      'ответ сервера затёр набранное — правка снова теряется',
    ).toHaveValue('2600')

    // И правка доезжает до базы, а не остаётся только на экране.
    await page.getByTestId('item-save-button').click()
    await expect
      .poll(async () => (await apiGet<CmsItem>(request, token, `/api/cms/items/${id}`)).price, {
        timeout: 15_000,
      })
      .toBe(260000)
  })

  test('нетронутое поле обновляется ответом сервера, а метка гаснет', async ({
    page,
    request,
  }) => {
    /*
      ОБРАТНАЯ ЯМА. Защитить набранное легко ценой того, что форма перестаёт
      обновляться вовсе: тогда нормализация сервера не доезжает, форма остаётся
      «не сохранена» навсегда, а на экране висит не то, что в базе.

      Цена — удобный свидетель: человек набирает «2600», сервер хранит в
      копейках и возвращает «2600.00». Если поле после ответа показывает
      серверную запись — гидратация нетронутых полей жива.
    */
    const token = await apiToken(request)
    const { id } = await openFreshItem(page, request)

    await page.getByTestId('item-price-input').fill('2600')
    await page.getByTestId('item-save-button').click()

    // Ничего не трогаем — ждём, что скажет сервер.
    await expect(page.getByTestId('item-price-input')).toHaveValue('2600.00', {
      timeout: 15_000,
    })
    await expect(
      page.getByTestId('item-dirty-badge'),
      'метка «не сохранено» не гаснет — форма осталась грязной навсегда',
    ).toBeHidden({ timeout: 15_000 })

    expect((await apiGet<CmsItem>(request, token, `/api/cms/items/${id}`)).price).toBe(260000)
  })

  test('после перезагрузки в базе и на экране то, что сохраняли', async ({ page, request }) => {
    const token = await apiToken(request)
    const { id } = await openFreshItem(page, request)

    await page.getByTestId('item-price-input').fill('3100')
    await page.getByTestId('item-save-button').click()
    await expect(page.getByTestId('item-dirty-badge')).toBeHidden({ timeout: 15_000 })

    await page.reload()
    await expect(page.getByTestId('item-price-input')).toHaveValue('3100.00', { timeout: 20_000 })
    expect((await apiGet<CmsItem>(request, token, `/api/cms/items/${id}`)).price).toBe(310000)
  })
})
