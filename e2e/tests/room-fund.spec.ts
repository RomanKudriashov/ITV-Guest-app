import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken, DEMO_ROOM } from './helpers'

/**
 * Номерной фонд: листание, человеческий порядок, переименование.
 *
 * Definition of Done: экран говорит, сколько всего номеров и какую часть он
 * показывает; порядок не лексикографический; переименование не проходит молча
 * — диалог называет обе невидимые беды (наклейка QR и имя устройства iRidi).
 *
 * Каждый тест заводит свои номера с уникальным суффиксом и уносит их за
 * собой: экран фонда общий, и оставленный мусор меняет то, что считает сосед.
 */

const uniq = () => Date.now().toString().slice(-6)

async function openAdmin(page: Page, path: string): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(ADMIN.email)
  await page.getByTestId('login-password').fill(ADMIN.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  await page.goto(path)
}

test.describe('Номерной фонд', () => {
  test('счётчик называет ВЕСЬ фонд, а не размер страницы', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)
    const headers = apiHeaders(token)

    const all = await (await request.get(`${API}/api/cms/rooms?limit=500`, { headers })).json()
    const total: number = all.total

    await openAdmin(page, '/cms/rooms')
    await expect(page.getByTestId('rooms-list')).toBeVisible({ timeout: 20_000 })

    // Строка счётчика несёт ИМЕННО общее число — то, которого на экране не было
    // вовсе: сотня строк при трёхстах номерах выглядела полным списком.
    await expect(page.getByTestId('rooms-range')).toContainText(String(total), {
      timeout: 15_000,
    })
  })

  test('вторая страница — другие номера, и порядок сквозной', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)
    const headers = apiHeaders(token)

    const suffix = uniq()
    const made: string[] = []
    // Номера РАЗНОЙ ШИРИНЫ: на одинаковой лексикографический порядок случайно
    // совпадает с верным, и проверка ничего не поймала бы.
    for (const value of ['7', '12', '100', '99']) {
      const response = await request.post(`${API}/api/cms/rooms`, {
        headers,
        data: { number: `${value}-${suffix}`, floor: 'т' },
      })
      expect(response.ok(), `номер ${value} не завёлся`).toBeTruthy()
      made.push((await response.json()).id)
    }

    try {
      await openAdmin(page, `/cms/rooms?search=${suffix}`)
      await expect(page.getByTestId('rooms-list')).toBeVisible({ timeout: 20_000 })

      // Читаем ИМЕННО ячейку номера: первая колонка теперь галочка выделения,
      // и разбор строки по первому переводу строки поймал бы пустоту.
      const rows = page.getByTestId('rooms-list').locator('tbody tr')
      const order: string[] = []
      for (let index = 0; index < (await rows.count()); index += 1) {
        order.push((await rows.nth(index).locator('td').nth(1).innerText()).trim())
      }
      expect(order, 'порядок должен быть человеческим, а не по строке').toEqual([
        `7-${suffix}`,
        `12-${suffix}`,
        `99-${suffix}`,
        `100-${suffix}`,
      ])

      // Листание: на выборке из четырёх «вперёд» недоступно — страница одна,
      // и экран об этом говорит честно, а не показывает мёртвую кнопку.
      await expect(page.getByTestId('rooms-next')).toBeDisabled()
      await expect(page.getByTestId('rooms-prev')).toBeDisabled()
    } finally {
      for (const id of made) {
        await request.delete(`${API}/api/cms/rooms/${id}`, { headers })
      }
    }
  })

  test('УКУС: переименование не проходит молча — диалог называет QR и устройство', async ({
    page,
    request,
  }) => {
    const token = await apiToken(request, ADMIN)
    const headers = apiHeaders(token)

    await openAdmin(page, `/cms/rooms?search=${DEMO_ROOM}`)
    await expect(page.getByTestId(`room-row-${DEMO_ROOM}`)).toBeVisible({ timeout: 20_000 })

    await page.getByTestId(`room-edit-${DEMO_ROOM}`).click()
    const newNumber = `${DEMO_ROOM}-${uniq()}`
    await page.getByTestId('room-number').fill(newNumber)
    await page.getByTestId('room-dialog').getByTestId('room-save').click()

    // Сохранение НЕ случилось: сначала разбор последствий.
    const dialog = page.getByTestId('room-rename-dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    // Наклейка на стене ведёт на старый адрес — это и сказано, с адресом.
    await expect(page.getByTestId('room-rename-qr')).toContainText(`/r/${DEMO_ROOM}`)
    // Демо-комната управляется, значит имя устройства меняется — и названо.
    await expect(page.getByTestId('room-rename-device')).toContainText(DEMO_ROOM)

    // Отмена — и номер остался прежним. Проверяем фактом на сервере, а не
    // видом экрана: экран мог просто не успеть обновиться.
    await dialog.getByRole('button').filter({ hasText: /Отмена|Cancel/ }).click()
    const rooms = await (
      await request.get(`${API}/api/cms/rooms?search=${DEMO_ROOM}`, { headers })
    ).json()
    expect(
      rooms.items.some((room: { number: string }) => room.number === DEMO_ROOM),
      'отказ от подтверждения не должен ничего переименовывать',
    ).toBeTruthy()
  })
})

test.describe('Номерной фонд: заведение пачкой и массовая правка', () => {
  test('УКУС: предпросмотр показывает список ДО создания, опечатка не создаёт ничего', async ({
    page,
    request,
  }) => {
    const token = await apiToken(request, ADMIN)
    const headers = apiHeaders(token)

    await openAdmin(page, '/cms/rooms')
    await expect(page.getByTestId('rooms-list')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('room-bulk-add').click()

    // 1. Опечатка «1-99999»: предпросмотр упирается в предел, кнопка создания
    //    недоступна — и в базе ничего не появляется.
    await page.getByTestId('room-bulk-spec').fill('1-99999')
    await expect(page.getByTestId('room-bulk-preview-error')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('room-bulk-submit')).toBeDisabled()

    const afterTypo = await (
      await request.get(`${API}/api/cms/rooms?search=99998&limit=500`, { headers })
    ).json()
    expect(afterTypo.total, 'опечатка не должна создать ни одного номера').toBe(0)

    /*
      2. Нормальный ввод.

      ВСЕ номера несут один уникальный суффикс — и диапазон тоже. Первая
      версия писала фиксированный «2201-2203», а убирала за собой по поиску
      «2201»: два номера оставались на стенде после каждого прогона. Проверка,
      оставляющая след, сама становится состоянием стенда.
    */
    const suffix = uniq()
    const spec = `${suffix}1-${suffix}3, 22А-${suffix}, Люкс-${suffix}`
    await page.getByTestId('room-bulk-spec').fill(spec)
    await expect(page.getByTestId('room-bulk-preview-list')).toContainText(`Люкс-${suffix}`, {
      timeout: 15_000,
    })
    await expect(page.getByTestId('room-bulk-preview-list')).toContainText(`${suffix}2`)

    try {
      await page.getByTestId('room-bulk-submit').click()
      await expect(page.getByTestId('room-bulk-result')).toBeVisible({ timeout: 15_000 })

      // Буквенный номер действительно заведён — раньше такие заводили поштучно.
      const created = await (
        await request.get(`${API}/api/cms/rooms?search=${suffix}&limit=500`, { headers })
      ).json()
      const numbers = created.items.map((room: { number: string }) => room.number)
      expect(numbers).toContain(`Люкс-${suffix}`)
      expect(numbers).toContain(`22А-${suffix}`)
      expect(numbers).toContain(`${suffix}2`)
    } finally {
      // Один поиск по суффиксу накрывает ВСЁ, что завела эта проверка.
      const all = await (
        await request.get(`${API}/api/cms/rooms?search=${suffix}&limit=500`, { headers })
      ).json()
      for (const room of all.items) {
        await request.delete(`${API}/api/cms/rooms/${room.id}`, { headers })
      }
    }
  })

  test('УКУС: «выбрать все» правит ВСЮ выборку, а не видимую страницу', async ({
    page,
    request,
  }) => {
    const token = await apiToken(request, ADMIN)
    const headers = apiHeaders(token)
    const floor = `e2e-${uniq()}`

    // 60 номеров при странице в 50: ровно та ситуация, в которой «выделить
    // все» по видимой странице изменило бы пятьдесят и промолчало.
    const made = await request.post(`${API}/api/cms/rooms/bulk`, {
      headers,
      data: { spec: '2301-2360', floor },
    })
    expect(made.ok(), 'фонд для проверки не завёлся').toBeTruthy()

    const category = await (
      await request.post(`${API}/api/cms/room-categories`, {
        headers,
        data: { title: { ru: `Делюкс ${uniq()}` } },
      })
    ).json()

    try {
      await openAdmin(page, `/cms/rooms?floor=${floor}`)
      await expect(page.getByTestId('rooms-list')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('rooms-range')).toContainText('60')

      await page.getByTestId('rooms-select-page').click()
      // Полоса выделения предлагает расширить выбор на ВСЮ выборку и называет
      // число — 60, а не 50.
      await expect(page.getByTestId('rooms-select-all-matching')).toContainText('60')
      await page.getByTestId('rooms-select-all-matching').click()
      await expect(page.getByTestId('rooms-selection-count')).toContainText('60')

      await page.getByTestId('rooms-bulk-edit').click()
      await expect(page.getByTestId('rooms-bulk-edit-scope')).toContainText('60')
      await page.getByTestId('rooms-bulk-category').selectOption(category.id)
      await page.getByTestId('rooms-bulk-apply').click()

      // Проверяем фактом на сервере: изменились все шестьдесят.
      await expect(async () => {
        const check = await (
          await request.get(`${API}/api/cms/rooms?floor=${floor}&category=${category.id}&limit=500`, {
            headers,
          })
        ).json()
        expect(check.total).toBe(60)
      }).toPass({ timeout: 20_000 })
    } finally {
      const all = await (
        await request.get(`${API}/api/cms/rooms?floor=${floor}&limit=500`, { headers })
      ).json()
      for (const room of all.items) {
        await request.delete(`${API}/api/cms/rooms/${room.id}`, { headers })
      }
      await request.delete(`${API}/api/cms/room-categories/${category.id}`, { headers })
    }
  })
})

test.describe('Сетка номерного фонда', () => {
  test('кубики стоят по этажам, легенда объясняет серый цвет', async ({ page }) => {
    await openAdmin(page, '/cms/rooms?view=grid')
    await expect(page.getByTestId('rooms-grid')).toBeVisible({ timeout: 20_000 })

    // Легенда обязательна: серые кубики без объяснения читаются как «данные не
    // доехали», а на самом деле это «занятости у нас нет».
    await expect(page.getByTestId('rooms-grid-legend')).toContainText('занятость')

    // Этажи демо-отеля: 2, 3, 4 — каждый своей строкой.
    for (const floor of ['2', '3', '4']) {
      await expect(page.getByTestId(`rooms-grid-floor-${floor}`)).toBeVisible()
    }
    await expect(page.getByTestId(`room-cube-${DEMO_ROOM}`)).toBeVisible()

    // Счётчик говорит, сколько показано из скольких.
    await expect(page.getByTestId('rooms-grid-counter')).toContainText('9')
  })

  test('УКУС: отфильтрованное ГАСНЕТ, а не исчезает — ряды не рвутся', async ({ page }) => {
    await openAdmin(page, '/cms/rooms?view=grid')
    await expect(page.getByTestId('rooms-grid')).toBeVisible({ timeout: 20_000 })

    const before = await page.getByTestId(/^room-cube-/).count()
    expect(before).toBeGreaterThan(1)

    // Ищем один номер: остальные обязаны остаться на своих местах.
    await page.getByTestId('rooms-search').fill(DEMO_ROOM)

    await expect(page.getByTestId('rooms-grid-counter')).toContainText('1', { timeout: 15_000 })
    const after = await page.getByTestId(/^room-cube-/).count()
    expect(after, 'кубики не должны исчезать — иначе сетка рассыпается').toBe(before)

    // Найденный не погашен, соседний — погашен.
    await expect(page.getByTestId(`room-cube-${DEMO_ROOM}`)).toHaveAttribute('data-dimmed', 'no')
    await expect(page.getByTestId('room-cube-201')).toHaveAttribute('data-dimmed', 'yes')
  })

  test('клик по кубику открывает панель, сетка остаётся на экране', async ({ page }) => {
    await openAdmin(page, '/cms/rooms?view=grid')
    await expect(page.getByTestId('rooms-grid')).toBeVisible({ timeout: 20_000 })

    await page.getByTestId(`room-cube-${DEMO_ROOM}`).click()
    await expect(page.getByTestId('room-panel')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('room-panel-number')).toHaveText(DEMO_ROOM)

    // Сетка не накрыта: она остаётся видимой слева — ради этого панель, а не
    // диалог.
    await expect(page.getByTestId('rooms-grid')).toBeVisible()
    await expect(page.getByTestId('room-panel-guest-url')).toContainText(`/r/${DEMO_ROOM}`)

    await page.getByTestId('room-panel-close').click()
    await expect(page.getByTestId('room-panel')).toBeHidden()
  })
})

test.describe('Аналитика: разрез по категории номера', () => {
  test('УКУС: «без категории» показана и объяснена, а не спрятана', async ({ page }) => {
    await openAdmin(page, '/cms/analytics')
    // Вкладка продаж — там живёт разбивка.
    await expect(page.getByTestId('analytics-breakdown-table')).toBeVisible({ timeout: 30_000 })

    // Селект здесь не нативный (MUI Select): открываем список и выбираем пункт
    // по подписи — ровно так же, как это делает человек.
    await page.getByTestId('analytics-breakdown-dimension').click()
    await page.getByRole('option', { name: 'Категория номера' }).click()

    // На стенде категорий нет ни у одного номера, и весь объём попадает в
    // «Без категории». Экран обязан это сказать словами, а не показать пустоту.
    await expect(page.getByTestId('analytics-category-unknown')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('analytics-category-unknown')).toContainText('до появления')
    await expect(page.getByTestId('analytics-breakdown-table')).toContainText('Без категории')
  })
})

test('сетка: выделение рамкой — тот же механизм, что и в списке', async ({ page }) => {
  await openAdmin(page, '/cms/rooms?view=grid')
  await expect(page.getByTestId('rooms-grid')).toBeVisible({ timeout: 20_000 })

  /*
    ОТКУДА ТЯНУТЬ. Первая версия начинала рамку за 6 px левее кубика 201 — а он
    стоит вплотную к левому краю сетки, и точка оказывалась ВНЕ её поверхности:
    рамка не стартовала вовсе. Теперь старт — на строке счётчика, заведомо
    внутри сетки и не на кубике, а конец — в правом нижнем углу, охватывающем
    все кубики второго этажа. Так проверка не зависит от того, в сколько строк
    перенесётся этаж на данной ширине.
  */
  const surface = await page.getByTestId('rooms-grid').boundingBox()
  const counter = await page.getByTestId('rooms-grid-counter').boundingBox()
  const cubes = await Promise.all(
    ['201', '205', '212'].map((number) => page.getByTestId(`room-cube-${number}`).boundingBox()),
  )
  expect(surface && counter && cubes.every(Boolean)).toBeTruthy()

  const right = Math.max(...cubes.map((box) => box!.x + box!.width))
  const bottom = Math.max(...cubes.map((box) => box!.y + box!.height))

  await page.mouse.move(surface!.x + 2, counter!.y + counter!.height / 2)
  await page.mouse.down()
  await page.mouse.move(right, bottom, { steps: 8 })
  await expect(page.getByTestId('rooms-grid-marquee')).toBeVisible()
  await page.mouse.up()

  // Полоса выделения — та же самая, что у списка, и она называет число.
  await expect(page.getByTestId('rooms-selection-bar')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('rooms-selection-count')).toContainText('3')
  await page.getByTestId('rooms-selection-clear').click()
  await expect(page.getByTestId('rooms-selection-bar')).toBeHidden()
})
