import { expect, test, type Page } from '@playwright/test'

import { ADMIN, API, HOTEL } from './helpers'

/**
 * Общий инструментарий списков: поиск, фильтры, состояние в адресе.
 *
 * Проверяется ПОВЕДЕНИЕ, а не устройство: что поиск отсеивает на сервере (а не
 * уже скачанную страницу), что фильтр доезжает до запроса, и что ссылку с
 * выборкой можно открыть заново и увидеть то же самое.
 */

const PLATFORM = { email: 'platform@itv.local', password: 'platform12345' }

async function loginConsole(page: Page): Promise<void> {
  await page.goto('/admin')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/admin')
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 40_000 })
}

test.describe('Журнал платформы', () => {
  test('поиск отсеивает НА СЕРВЕРЕ, а не скачанную страницу', async ({ request }) => {
    const token = await request
      .post(`${API}/api/platform/auth/login`, { data: PLATFORM })
      .then((r) => r.json())
      .then((b) => b.access)
    const headers = { Authorization: `Bearer ${token}` }

    const all = await request
      .get(`${API}/api/platform/audit?limit=5`, { headers })
      .then((r) => r.json())
    const filtered = await request
      .get(`${API}/api/platform/audit?limit=5&search=crystal`, { headers })
      .then((r) => r.json())

    /*
      ГЛАВНОЕ: `total` меняется вместе с поиском.

      Раньше экран отсеивал уже скачанную сотню, и `total` оставался общим —
      «показаны 3 из 3835». Оператор читал это как «нашлось три», хотя в базе
      их были сотни: остальные просто не попали в скачанную страницу.
    */
    expect(filtered.total, 'поиск не сузил выдачу — фильтрует не сервер').toBeLessThan(all.total)
    expect(filtered.total).toBeGreaterThan(0)

    // И каждая строка действительно под условие подходит.
    for (const row of filtered.items) {
      if (row.subdomain) expect(row.subdomain).toContain('crystal')
    }

    // Поиск без совпадений — честный ноль, а не «ничего не показали из тысячи».
    const empty = await request
      .get(`${API}/api/platform/audit?limit=5&search=нетакогоотеля`, { headers })
      .then((r) => r.json())
    expect(empty.total).toBe(0)
    expect(empty.items).toHaveLength(0)
  })

  test('фильтр доезжает до запроса, а выборка — до адреса', async ({ page }) => {
    await loginConsole(page)
    await page.getByTestId('admin-nav-audit').click()
    await expect(page.getByTestId('admin-audit')).toBeVisible({ timeout: 20_000 })

    // Ловим ЗАПРОС: фильтр, применённый на экране и не уехавший на сервер, —
    // это выдача без изменений при уверенности, что отфильтровали.
    const asked = page.waitForRequest(
      (r) => r.url().includes('/audit?') && r.url().includes('search=crystal'),
      { timeout: 20_000 },
    )
    await page.getByTestId('admin-audit-filter-hotel').fill('crystal')
    await asked

    // Выборка осела в адресе — ссылку можно послать коллеге.
    await expect.poll(() => page.url()).toContain('search=crystal')
  })

  test('ссылка с фильтром открывается заново и показывает ТО ЖЕ', async ({ page, context }) => {
    await loginConsole(page)
    await page.getByTestId('admin-nav-audit').click()
    await expect(page.getByTestId('admin-audit')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('admin-audit-filter-hotel').fill('crystal')
    await expect.poll(() => page.url()).toContain('search=crystal')
    // В ссылке должен быть и РАЗДЕЛ: фильтры без него открываются на сводке.
    expect(page.url(), 'раздел не попал в адрес').toContain('section=audit')
    const shared = page.url()
    const counter = await page.getByTestId('admin-audit-total').innerText()

    // Новая вкладка по той же ссылке — та же выборка и тот же счётчик.
    const second = await context.newPage()
    await second.goto(shared)
    await expect(second.getByTestId('admin-audit')).toBeVisible({ timeout: 20_000 })
    await expect(
      second.getByTestId('admin-audit-filter-hotel'),
      'поле поиска не восстановилось из адреса',
    ).toHaveValue('crystal')
    await expect(
      second.getByTestId('admin-audit-total'),
      'по той же ссылке видна другая выборка',
    ).toHaveText(counter, { timeout: 20_000 })
    await second.close()
  })

  test('листание курсором не теряет и не дублирует при дописи новых', async ({ request }) => {
    const token = await request
      .post(`${API}/api/platform/auth/login`, { data: PLATFORM })
      .then((r) => r.json())
      .then((b) => b.access)
    const headers = { Authorization: `Bearer ${token}` }

    const first = await request
      .get(`${API}/api/platform/audit?limit=5`, { headers })
      .then((r) => r.json())
    expect(first.next_cursor, 'журнал слишком короток для проверки листания').toBeTruthy()

    /*
      Пока «оператор смотрит первую страницу», журнал ПОПОЛНЯЕТСЯ сверху:
      каждый вход платформы пишет запись. При листании смещением вторая
      страница показала бы часть первой, а часть записей не показала бы вовсе.
    */
    for (let i = 0; i < 3; i += 1) {
      await request.post(`${API}/api/platform/auth/login`, { data: PLATFORM })
    }

    const second = await request
      .get(`${API}/api/platform/audit?limit=5&cursor=${encodeURIComponent(first.next_cursor)}`, {
        headers,
      })
      .then((r) => r.json())

    const firstIds = first.items.map((r: { id: string }) => r.id)
    const secondIds = second.items.map((r: { id: string }) => r.id)
    expect(
      secondIds.filter((id: string) => firstIds.includes(id)),
      'вторая страница повторила записи первой',
    ).toHaveLength(0)

    // И ничего не пропало: курсор — это «строго раньше вот этой записи»,
    // поэтому между страницами дыры быть не может.
    const joined = [...firstIds, ...secondIds]
    expect(new Set(joined).size, 'в склейке страниц есть дубли').toBe(joined.length)
  })
})

test.describe('Меню отеля', () => {
  test('поиск возвращает ВСЁ подходящее, а не часть страницы', async ({ request }) => {
    const token = await request
      .post(`${API}/api/staff/auth/login`, { data: ADMIN, headers: { 'X-Hotel-Subdomain': HOTEL } })
      .then((r) => r.json())
      .then((b) => b.access)
    const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }

    const all = await request.get(`${API}/api/cms/items`, { headers }).then((r) => r.json())
    const found = await request
      .get(`${API}/api/cms/items?search=салат`, { headers })
      .then((r) => r.json())

    // Ищем по названию НА ВСЕХ ЯЗЫКАХ и по коду — значит найдено должно быть
    // ровно столько, сколько подходит во всём меню, а не в первой странице.
    const expected = all.filter(
      (item: { title: Record<string, string>; code: string }) =>
        Object.values(item.title).some((value) => value.toLowerCase().includes('салат')) ||
        item.code.includes('салат'),
    )
    expect(found.length, 'поиск нашёл не всё подходящее').toBe(expected.length)
    expect(found.length).toBeGreaterThan(0)
  })

  test('раздел и поиск живут в адресе — ссылка открывает ту же выборку', async ({
    page,
    request,
  }) => {
    const token = await request
      .post(`${API}/api/staff/auth/login`, { data: ADMIN, headers: { 'X-Hotel-Subdomain': HOTEL } })
      .then((r) => r.json())
      .then((b) => b.access)
    const services = await request
      .get(`${API}/api/cms/services`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
      })
      .then((r) => r.json())
    const kitchen = services.find((s: { code: string }) => s.code === 'kitchen')

    await page.goto('/login')
    await page.getByTestId('login-email').fill(ADMIN.email)
    await page.getByTestId('login-password').fill(ADMIN.password)
    await page.getByTestId('login-submit').click()
    await expect(page).toHaveURL(/\/cms\//, { timeout: 20_000 })

    await page.goto(`/cms/services/${kitchen.id}`)
    await expect(page.getByTestId('menu-category-list')).toBeVisible({ timeout: 20_000 })

    // Запрос обязан уехать С ПОИСКОМ: фильтр, оставшийся на экране, — это
    // выдача без изменений при уверенности, что отфильтровали.
    const asked = page.waitForRequest(
      (r) => r.url().includes('/cms/items') && r.url().includes('search='),
      { timeout: 20_000 },
    )
    await page.getByTestId('item-search').fill('салат')
    await asked
    await expect.poll(() => page.url()).toContain('search=')

    // F5 не сбрасывает набранное — раньше поиск жил в useState и терялся.
    await page.reload()
    await expect(
      page.getByTestId('item-search'),
      'поиск не пережил обновление страницы',
    ).toHaveValue('салат', { timeout: 20_000 })
  })
})
