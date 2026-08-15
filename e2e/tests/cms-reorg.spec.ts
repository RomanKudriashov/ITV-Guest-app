import { expect, test } from '@playwright/test'

import { ADMIN, API, apiHeaders, apiToken, DEMO_ROOM, login } from './helpers'

/**
 * R4: реорганизованная CMS.
 *
 * Проверяем НОВЫЙ поток, а не «ничего не сломалось»:
 *   1. навигация сгруппирована, плоской простыни нет;
 *   2. выключенный модуль прячет свой раздел, включённый — показывает;
 *   3. админ создаёт сервис из шаблона и попадает в его пространство;
 *   4. админ включает чужой контент в сервис — и гость видит его в меню.
 */

test.describe('Навигация CMS', () => {
  test('разделы сгруппированы, плоской простыни больше нет', async ({ page }) => {
    await login(page)

    const nav = page.getByTestId('main-nav')
    await expect(nav).toBeVisible()

    // Группы карты продукта — с заголовками, а не 18 равнозначных пунктов.
    await expect(page.getByTestId('nav-group-operations')).toBeVisible()
    await expect(page.getByTestId('nav-group-structure')).toBeVisible()
    await expect(page.getByTestId('nav-group-appearance')).toBeVisible()
    await expect(page.getByTestId('nav-group-settings')).toBeVisible()

    // Сервисы — верхним уровнем.
    await expect(page.getByTestId('cms-nav-services')).toBeVisible()

    // Растворённого и слитого в навигации быть не должно.
    await expect(page.getByTestId('cms-nav-commerce')).toHaveCount(0)
    await expect(page.getByTestId('cms-nav-showcase')).toHaveCount(0)
    await expect(page.getByTestId('cms-nav-locations')).toHaveCount(0)
    await expect(page.getByTestId('cms-nav-departments')).toHaveCount(0)
  })

  test('модуль выключен — его раздела нет; включён — появляется', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)

    // Исходное состояние модуля — не наше дело: наглядный «Кристалл»
    // (`--with-rich-catalog`) включает маркетинг, чтобы демо-витрина была
    // полной. Тест проверяет ПЕРЕКЛЮЧЕНИЕ, поэтому обе точки — «выключен» и
    // «включён» — расставляет сам, а в конце возвращает стенд как было.
    const wasEnabled = await moduleEnabled(request, 'marketing')
    await enableModule(request, 'marketing', false)

    await login(page)
    try {
      // Проверяем отсутствие ПУНКТА маркетинга, а не всей группы «Модули»:
      // на наглядном стенде группу держит другой включённый модуль (PMS).
      await expect(page.getByTestId('cms-nav-marketing')).toHaveCount(0)

      // Спрашиваем про САМ маркетинг, а не про существование группы «Модули»:
      // на наглядном стенде группа остаётся из-за других включённых модулей
      // (PMS), и «группы нет» проверяло бы не то, ради чего написан тест.
      expect(await navItems(request, token, 'modules')).not.toContain('marketing')

      // Включаем маркетинг платформенным реестром модулей (R1).
      await enableModule(request, 'marketing', true)
      await page.reload()
      await expect(page.getByTestId('nav-group-modules')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('cms-nav-marketing')).toBeVisible()
      expect(await navItems(request, token, 'modules')).toContain('marketing')

      await enableModule(request, 'marketing', false)
      await page.reload()
      await expect(page.getByTestId('cms-nav-marketing')).toHaveCount(0)
    } finally {
      await enableModule(request, 'marketing', wasEnabled)
    }
  })
})

test.describe('Пространство сервиса', () => {
  test('админ создаёт сервис из шаблона и попадает в его вкладки', async ({ page }) => {
    await login(page)
    await page.getByTestId('cms-nav-services').click()
    await expect(page.getByTestId('cms-services')).toBeVisible()

    const name = `Пляжный бар ${Date.now().toString(36)}`
    await page.getByTestId('services-add').click()

    // Шаблон объясняет, что получится, ДО создания.
    await expect(page.getByTestId('service-create-template')).toBeVisible()
    await page.getByTestId('service-create-name').fill(name)
    await page.getByTestId('service-create-submit').click()

    // Провалились в рабочее пространство нового заведения.
    await expect(page.getByTestId('cms-service-workspace')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(name)).toBeVisible()

    // Вкладки на месте, включая «Включённый контент».
    for (const tab of ['menu', 'schedule', 'delivery', 'commerce', 'staff', 'inclusions']) {
      await expect(page.getByTestId(`service-tab-${tab}`)).toBeVisible()
    }

    await page.getByTestId('service-tab-inclusions').click()
    await expect(page.getByTestId('service-inclusions')).toBeVisible()
  })

  test('меню на вкладке принадлежит ИМЕННО этому заведению', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)
    const services = (await request
      .get(`${API}/api/cms/services`, { headers: apiHeaders(token) })
      .then((r) => r.json())) as Array<{ id: string; code: string }>

    const kitchen = services.find((s) => s.code === 'kitchen')!
    const concierge = services.find((s) => s.code === 'concierge')!

    // Разделы кухни и консьержа не пересекаются — это и есть «меню какого
    // ресторана» со стороны CMS.
    const kitchenCats = await request
      .get(`${API}/api/cms/categories?service_id=${kitchen.id}`, { headers: apiHeaders(token) })
      .then((r) => r.json())
    const conciergeCats = await request
      .get(`${API}/api/cms/categories?type=service_request&service_id=${concierge.id}`, {
        headers: apiHeaders(token),
      })
      .then((r) => r.json())

    const kitchenCodes = kitchenCats.map((c: { code: string }) => c.code)
    const conciergeCodes = conciergeCats.map((c: { code: string }) => c.code)

    expect(kitchenCodes.length).toBeGreaterThan(0)
    expect(conciergeCodes).toContain('transfer')
    expect(kitchenCodes).not.toContain('transfer')

    await login(page)
    await page.goto(`/cms/services/${kitchen.id}`)
    await expect(page.getByTestId('service-menu')).toBeVisible({ timeout: 20_000 })
  })
})

test.describe('Включённый контент', () => {
  test('админ включает контент в сервис — гость видит его в меню', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)
    const h = apiHeaders(token)
    const tag = Date.now().toString(36)

    const services = (await request
      .get(`${API}/api/cms/services`, { headers: h })
      .then((r) => r.json())) as Array<{ id: string; code: string }>
    const kitchen = services.find((s) => s.code === 'kitchen')!

    // Новый агрегатор без собственного меню.
    const aggregator = await request
      .post(`${API}/api/cms/services`, {
        data: { type: 'room_service', public_name: { ru: `Ночное меню ${tag}` } },
        headers: h,
      })
      .then((r) => r.json())

    const aggregatorPoint = aggregator.execution_point.code

    // Пока ничего не включено — меню агрегатора пусто у гостя.
    const before = await guestMenu(request, aggregatorPoint)
    expect(before).toEqual([])

    // Включаем кухню целиком — через UI.
    await login(page)
    await page.goto(`/cms/services/${aggregator.id}`)
    await page.getByTestId('service-tab-inclusions').click()
    await expect(page.getByTestId('service-inclusions')).toBeVisible()

    await page.getByTestId('inclusion-add-source').click()
    await page.getByRole('option', { name: /Панорама/ }).click()

    // Включение появилось карточкой с overlay-настройками.
    await expect(page.locator('[data-testid^="inclusion-"]').first()).toBeVisible({
      timeout: 15_000,
    })

    // И гость немедленно видит заимствованное меню — это ссылка, а не копия.
    await expect
      .poll(async () => (await guestMenu(request, aggregatorPoint)).length, { timeout: 20_000 })
      .toBeGreaterThan(0)

    const after = await guestMenu(request, aggregatorPoint)
    expect(after).toContain('caesar')
    expect(kitchen).toBeTruthy()
  })
})

/* ── Помощники ─────────────────────────────────────────────────────────── */

async function enableModule(
  request: import('@playwright/test').APIRequestContext,
  code: string,
  enabled: boolean,
): Promise<void> {
  // Реестр модулей — платформенный уровень (R1); отель его только читает.
  const platform = await request.post(`${API}/api/platform/auth/login`, {
    data: { email: 'platform@itv.local', password: 'platform12345' },
  })
  expect(platform.ok(), await platform.text()).toBeTruthy()
  const token = (await platform.json()).access

  // ИЩЕМ, а не перебираем список: у выдачи отелей теперь есть предел, и на
  // большом стенде демо-отель просто не попадает на первую страницу.
  const hotels = await request
    .get(`${API}/api/v1/platform/fleet?search=crystal&origin=all`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then((r) => r.json())
  const crystal = hotels.items.find(
    (hotel: { subdomain: string }) => hotel.subdomain === 'crystal',
  )

  const response = await request.put(`${API}/api/platform/hotels/${crystal.id}/modules`, {
    data: { modules: [{ code, is_enabled: enabled, source: 'override' }] },
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
}

/** Ключи пунктов в группе навигации CMS (пустой список, если группы нет). */
async function navItems(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  group: string,
): Promise<string[]> {
  const nav = (await request
    .get(`${API}/api/cms/navigation`, { headers: apiHeaders(token) })
    .then((r) => r.json())) as {
    groups: Array<{ key: string; items?: Array<{ key: string }> }>
  }
  const found = nav.groups.find((g) => g.key === group)
  return (found?.items ?? []).map((i) => i.key)
}

/** Текущее состояние модуля — чтобы вернуть стенд ровно как было. */
async function moduleEnabled(
  request: import('@playwright/test').APIRequestContext,
  code: string,
): Promise<boolean> {
  const platform = await request.post(`${API}/api/platform/auth/login`, {
    data: { email: 'platform@itv.local', password: 'platform12345' },
  })
  expect(platform.ok(), await platform.text()).toBeTruthy()
  const token = (await platform.json()).access

  // ИЩЕМ, а не перебираем список: у выдачи отелей теперь есть предел, и на
  // большом стенде демо-отель просто не попадает на первую страницу.
  const hotels = await request
    .get(`${API}/api/v1/platform/fleet?search=crystal&origin=all`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then((r) => r.json())
  const crystal = hotels.items.find(
    (hotel: { subdomain: string }) => hotel.subdomain === 'crystal',
  )

  const response = await request.get(`${API}/api/platform/hotels/${crystal.id}/modules`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const { modules } = (await response.json()) as {
    modules: Array<{ code: string; is_enabled: boolean }>
  }
  return Boolean(modules.find((m) => m.code === code)?.is_enabled)
}

/**
 * Меню одного заведения глазами гостя.
 *
 * Витрина сужается по коду ТОЧКИ ИСПОЛНЕНИЯ (`?point=`) — это третий уровень
 * витрины при нескольких ресторанах.
 */
async function guestMenu(
  request: import('@playwright/test').APIRequestContext,
  pointCode: string,
): Promise<string[]> {
  const session = await request.post(`${API}/api/guest/session`, {
    data: { room_number: DEMO_ROOM },
    headers: { 'X-Hotel-Subdomain': 'crystal' },
  })
  const token = (await session.json()).token
  const menu = await request
    .get(`${API}/api/guest/catalog?type=product&point=${pointCode}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': 'crystal' },
    })
    .then((r) => r.json())
  return (menu.categories ?? []).flatMap((c: { items: { code: string }[] }) =>
    c.items.map((i) => i.code),
  )
}

test('на телефоне навигация CMS уезжает в шторку и открывает раздел', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')
  await page.getByTestId('login-email').fill(ADMIN.email)
  await page.getByTestId('login-password').fill(ADMIN.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  await page.goto('/cms/dashboard')

  // Постоянная панель занимала 246px из 390 и оставляла контенту колонку в
  // одно слово. Теперь она открывается по кнопке.
  await page.getByTestId('nav-toggle').click()
  await expect(page.getByTestId('main-nav')).toBeVisible()
  await page.getByTestId('cms-nav-analytics').click()
  await expect(page).toHaveURL(/\/cms\/analytics/, { timeout: 15_000 })
})
