import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { ADMIN, API, apiToken, DEMO_ROOM, HOTEL, login } from './helpers'

/**
 * ПАРТИЯ 6: СЛОВО КАТАЛОГА И ПРИМЕНИМОСТЬ СПРАВОЧНИКОВ.
 *
 * Проверки идут по ЖИВОМУ стенду: и слово, и применимость выводятся сервером,
 * а показываются на экране. Мок доказал бы, что экран умеет рисовать, и
 * промолчал бы о том, доехал ли до него вывод.
 */

/** Заведение отеля по типу — с ним же приходит его слово. */
async function serviceOfType(
  request: APIRequestContext,
  token: string,
  type: string,
): Promise<{ id: string; code: string; noun: string }> {
  const response = await request.get(`${API}/api/cms/services?limit=200`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
  })
  expect(response.ok()).toBeTruthy()
  const rows = (await response.json()).items as { id: string; code: string; type: string; noun: string }[]
  const found = rows.find((row) => row.type === type && row.code === type)
    ?? rows.find((row) => row.type === type)
  expect(found, `на стенде нет заведения типа ${type}`).toBeTruthy()
  return found as { id: string; code: string; noun: string }
}

async function openWorkspace(page: Page, serviceId: string): Promise<void> {
  await page.goto(`/cms/services/${serviceId}`)
  await expect(page.getByTestId('cms-service-workspace')).toBeVisible({ timeout: 25_000 })
}

test.describe('Слово каталога следует за типом заведения', () => {
  test('кнопка в ресторане говорит «блюдо», в спа — «услуга»', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)
    const restaurant = await serviceOfType(request, token, 'restaurant')
    const spa = await serviceOfType(request, token, 'spa')

    // Сервер уже выводит слово — проверяем и его, иначе экран мог бы совпасть
    // случайно, читая не то поле.
    expect(restaurant.noun).toBe('dish')
    expect(spa.noun).toBe('service')

    await login(page, ADMIN)

    await openWorkspace(page, restaurant.id)
    await expect(page.getByTestId('add-item-button')).toHaveText(/блюдо/i)

    await openWorkspace(page, spa.id)
    const addInSpa = page.getByTestId('add-item-button')
    await expect(addInSpa).toHaveText(/услуг/i)
    // И ровно то, ради чего всё делалось: ресторанного слова здесь нет.
    await expect(addInSpa).not.toHaveText(/блюдо/i)
  })

  test('счётчик и пустое состояние говорят тем же словом, что кнопка', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)
    const spa = await serviceOfType(request, token, 'spa')

    await login(page, ADMIN)
    await openWorkspace(page, spa.id)

    /*
      СЛОВО ОДНО НА ВЕСЬ ЭКРАН, А НЕ ТОЛЬКО НА КНОПКЕ. Раньше каждая надпись
      несла свою строку со словом внутри, и переучить их разом было нельзя:
      достаточно было забыть одну, чтобы «Добавить услугу» соседствовало с
      «Блюд: 3».
    */
    const body = page.getByTestId('cms-service-workspace')
    await expect(body).not.toContainText(/Блюд:/i)
    await expect(body).not.toContainText(/Поиск блюда/i)
  })
})

test.describe('Применимость справочников', () => {
  test('у услуги аллергенов на экране нет вовсе', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)
    const spa = await serviceOfType(request, token, 'spa')

    // Сервер говорит прямо: справочник этому слову неприменим.
    const payload = await request.get(`${API}/api/cms/allergens?noun=service`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    expect((await payload.json()).kind_applies).toBe(false)

    await login(page, ADMIN)
    await openWorkspace(page, spa.id)

    // Открываем первую позицию заведения.
    const edit = page.locator('[data-testid^="item-edit-"]').first()
    if ((await edit.count()) === 0) test.skip(true, 'у спа нет позиций — проверять нечего')
    await edit.click()

    const facets = page.getByTestId('cms-item-facets')
    await expect(facets).toBeVisible({ timeout: 20_000 })
    /*
      ИМЕННО ОТСУТСТВИЕ, А НЕ СЕРОЕ ПОЛЕ. Серое поле говорит «сюда можно, но не
      сейчас», и человек ищет, чего ему не хватает; правда другая — сюда нельзя
      никогда.
    */
    await expect(facets).not.toContainText(/Аллергены/i)
    await expect(facets.locator('[data-testid^="item-allergen-"]')).toHaveCount(0)
  })

  test('у блюда аллергены на месте — проверка не зеленеет на пустом экране', async ({
    page,
    request,
  }) => {
    const token = await apiToken(request, ADMIN)
    const restaurant = await serviceOfType(request, token, 'restaurant')

    await login(page, ADMIN)
    await openWorkspace(page, restaurant.id)

    const edit = page.locator('[data-testid^="item-edit-"]').first()
    await expect(edit).toBeVisible({ timeout: 20_000 })
    await edit.click()

    const facets = page.getByTestId('cms-item-facets')
    await expect(facets).toBeVisible({ timeout: 20_000 })
    await expect(facets).toContainText(/Аллергены/i)
    await expect(facets.locator('[data-testid^="item-allergen-"]').first()).toBeVisible()
  })

  test('справочник объясняет пустоту и разводит наши записи с отельными', async ({ page }) => {
    await login(page, ADMIN)
    await page.goto('/cms/dictionaries')
    await expect(page.getByTestId('cms-dict-allergens')).toBeVisible({ timeout: 25_000 })

    // Спросили «что увидит услуга» — экран отвечает, что таких не бывает.
    await page.getByTestId('cms-dict-filter-allergens').click()
    await page.getByRole('option', { name: /услуг/i }).click()
    await expect(page.getByTestId('cms-dict-na-allergens')).toBeVisible({ timeout: 15_000 })

    // Вернули «все типы» — записи снова видны, и слои названы.
    await page.getByTestId('cms-dict-filter-allergens').click()
    await page.getByRole('option', { name: /всех типов/i }).click()
    const section = page.getByTestId('cms-dict-allergens')
    await expect(section).toContainText(/обновляем мы/i)
  })
})

test.describe('Метки: панель и витрина одним кодом', () => {
  test('значок в справочнике залит тем же цветом, что у гостя', async ({ page, request, browser }) => {
    const token = await apiToken(request, ADMIN)

    // Метка, которая реально висит на позиции: иначе у гостя её не увидеть.
    const badges = await request.get(`${API}/api/cms/badges`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    const rows = (await badges.json()).items as { id: string; items_count: number }[]
    const used = rows.find((row) => row.items_count > 0)
    expect(used, 'на стенде нет ни одной присвоенной метки — сид не довёз данные').toBeTruthy()

    await login(page, ADMIN)
    await page.goto('/cms/marketing')
    const pill = page.getByTestId(`cms-badge-pill-${used!.id}`)
    await expect(pill).toBeVisible({ timeout: 25_000 })
    const cmsFill = await pill.evaluate((node) => getComputedStyle(node).backgroundColor)

    /*
      СРАВНИВАЕМ ЦВЕТ, А НЕ РАЗМЕТКУ. «Показан так, как увидит гость» — это про
      результат на экране: два разных куска разметки могут давать одну заливку,
      и наоборот. Проверка держится ровно за то, что обещано человеку.
    */
    const guest = await browser.newPage()
    await guest.goto('/')
    await guest.evaluate(() => window.localStorage.clear())
    await guest.goto('/')
    await guest.getByTestId('guest-room-input').fill(DEMO_ROOM)
    await guest.getByTestId('guest-room-submit').click()
    const guestBadge = guest.getByTestId('guest-badge-0').first()
    await expect(guestBadge).toBeVisible({ timeout: 25_000 })
    const guestFill = await guestBadge.evaluate((node) => getComputedStyle(node).backgroundColor)
    await guest.close()

    expect(guestFill, 'значок в панели и у гостя залит по-разному').toBe(cmsFill)
  })

  test('удаление метки называет число и показывает, где она висит', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)
    const badges = await request.get(`${API}/api/cms/badges`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    const rows = (await badges.json()).items as { id: string; items_count: number }[]
    const used = rows.find((row) => row.items_count > 0)
    expect(used, 'нет присвоенных меток — проверять нечего').toBeTruthy()

    await login(page, ADMIN)
    await page.goto('/cms/marketing')
    await page.getByTestId(`cms-badge-delete-${used!.id}`).click()

    const dialog = page.getByTestId('cms-badge-delete-dialog')
    await expect(dialog).toBeVisible()
    // Число — в вопросе, список — под ним. Молча «снимется со всех» больше не
    // говорим: сколько их и какие, человек должен видеть до нажатия.
    await expect(dialog).toContainText(new RegExp(`${used!.items_count}`))
    await expect(page.getByTestId('cms-badge-delete-usage')).toBeVisible()
  })

  test('у метки из пресета карандаша нет вовсе', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)
    const badges = await request.get(`${API}/api/cms/badges`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    const rows = (await badges.json()).items as { id: string; preset?: string | null }[]
    const preset = rows.find((row) => row.preset)
    const own = rows.find((row) => !row.preset)
    expect(preset, 'в наборе нет пресетных меток').toBeTruthy()
    expect(own, 'в наборе нет отельных меток — граница не видна').toBeTruthy()

    await login(page, ADMIN)
    await page.goto('/cms/marketing')
    await expect(page.getByTestId(`cms-badge-row-${preset!.id}`)).toBeVisible({ timeout: 25_000 })

    // Не серая кнопка, а отсутствие: серая обещает, что когда-нибудь сработает.
    await expect(page.getByTestId(`cms-badge-edit-${preset!.id}`)).toHaveCount(0)
    // А у отельной карандаш на месте — иначе проверка выше зеленела бы на
    // экране, где правки нет ни у кого.
    await expect(page.getByTestId(`cms-badge-edit-${own!.id}`)).toBeVisible()
  })

  test('порядок меток меняется перетаскиванием и переживает перезагрузку', async ({
    page,
    request,
  }) => {
    const token = await apiToken(request, ADMIN)
    const order = async (): Promise<string[]> => {
      const response = await request.get(`${API}/api/cms/badges`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
      })
      return ((await response.json()).items as { id: string }[]).map((row) => row.id)
    }

    const before = await order()
    expect(before.length, 'меток меньше двух — переставлять нечего').toBeGreaterThan(1)

    await login(page, ADMIN)
    await page.goto('/cms/marketing')
    const handle = page.getByTestId(`cms-badge-drag-${before[0]}`)
    await expect(handle).toBeVisible({ timeout: 25_000 })

    const target = page.getByTestId(`cms-badge-drag-${before[1]}`)
    const from = await handle.boundingBox()
    const to = await target.boundingBox()
    expect(from && to).toBeTruthy()

    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
    await page.mouse.down()
    // Шагами: dnd-kit трогается с места после порога, и один прыжок курсора он
    // читает как случайный клик.
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2 + 4, { steps: 10 })
    await page.mouse.up()

    await expect
      .poll(async () => (await order())[0], { timeout: 20_000, message: 'порядок не сохранился' })
      .toBe(before[1])
  })
})
