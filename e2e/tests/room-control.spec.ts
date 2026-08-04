import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { ADMIN, API, DEMO_ROOM, HOTEL } from './helpers'

/**
 * Управление номером: подтверждение, оффлайн, отказ по доверию.
 *
 * ОДИН браузерный контекст на весь файл, и это осознанное ограничение, а не
 * упрощение. Два контекста сразу — единственное, что роднит два известных
 * флейка прогона (service-request и full-cycle), и заводить третий такой файл
 * ради «а посмотрим, как второй телефон увидит свет» значит гарантированно
 * добавить себе ещё один нестабильный тест. Рассылка снимка во все сессии
 * номера проверена на backend.
 *
 * Проверяется то, чего нельзя проверить в юнит-тесте: что гость ВИДИТ.
 */

async function enterRoom(page: Page, room = DEMO_ROOM): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(room)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-nav-room')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('guest-nav-room').click()
  await expect(page.getByTestId('room-page')).toBeVisible({ timeout: 15_000 })
}

/**
 * Геометрия плана из живого ответа — тем же путём, что её видит гость.
 *
 * Своя сессия, а не заглядывание в localStorage страницы: план принадлежит
 * ТИПУ номера и одинаков для всех сессий этой комнаты, а лезть во внутреннее
 * хранилище приложения ради него значит завязать тест на его устройство.
 */
async function roomStateFromApi(request: APIRequestContext): Promise<Record<string, unknown>> {
  const session = await request.post(`${API}/api/v1/guest/session`, {
    data: { room_number: DEMO_ROOM, language: 'ru' },
    headers: { 'X-Hotel-Subdomain': HOTEL },
  })
  expect(session.ok(), 'гостевая сессия').toBeTruthy()
  const state = await request.get(`${API}/api/v1/guest/room/state`, {
    headers: {
      Authorization: `Bearer ${(await session.json()).token}`,
      'X-Hotel-Subdomain': HOTEL,
    },
  })
  expect(state.ok(), 'снимок номера').toBeTruthy()
  return await state.json()
}

/**
 * Подменить снимок на весь оставшийся тест — вместе с КАНАЛОМ.
 *
 * Глушить один REST бесполезно: сервер шлёт полный снимок на подключение
 * сокета, и живое «всё работает» затирает подставленное состояние через долю
 * секунды. Проверка при этом не падает, а становится гонкой, что хуже.
 */
async function freezeState(page: Page, snapshot: Record<string, unknown>): Promise<void> {
  await page.routeWebSocket('**/ws/**', (ws) => ws.close())
  await page.route('**/api/v1/guest/room/state', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(snapshot),
    })
  })
}

/**
 * Демо-вход обязан быть ВКЛЮЧЁН до начала: без него команды запрещены и все
 * проверки экрана упрутся в заблокированные контролы.
 *
 * Раньше это подразумевалось — и подвело. `guest-surface.spec.ts` идёт раньше
 * по алфавиту, выключает модуль отеля и восстанавливает его платформенным
 * `PUT /hotels/{id}/modules`, а тот пишет `config` целиком: запрос без
 * `config` ЗАТИРАЕТ конфигурацию модуля вместе с флагом демо-входа. Тест,
 * который полагается на состояние, оставленное соседним файлом, — это не тест,
 * а совпадение.
 */
test.beforeAll(async ({ request }) => {
  const staff = await request.post(`${API}/api/staff/auth/login`, {
    data: ADMIN,
    headers: { 'X-Hotel-Subdomain': HOTEL },
  })
  expect(staff.ok(), 'вход администратора отеля').toBeTruthy()
  const token = (await staff.json()).access
  const on = await request.post(`${API}/api/v1/cms/grms/access/demo-entry`, {
    data: { enabled: true },
    headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
  })
  expect(on.ok(), `включение демо-входа -> ${on.status()}`).toBeTruthy()
})

test.describe('Управление номером', () => {
  test('пункт «Номер» ведёт на экран с живым состоянием из feedback', async ({ page }) => {
    await enterRoom(page)

    // Значения приезжают из ОБОРУДОВАНИЯ до первого взаимодействия, а не из
    // конфигурации: элемент, который не прочитали, был бы «нет связи».
    const light = page.getByTestId('room-control-light.living')
    await expect(light).toBeVisible({ timeout: 20_000 })
    await expect(light).toHaveAttribute('aria-pressed', /true|false/, { timeout: 20_000 })

    // Зоны разложены так же, как на плане номера.
    await expect(page.getByTestId('room-zone-living')).toBeVisible()
    await expect(page.getByTestId('room-zone-bedroom')).toBeVisible()

    // Контролов, которых нет в железе, на экране нет.
    await expect(page.getByTestId('room-ring-dimmer')).toHaveCount(0)
    await expect(page.getByTestId('room-position-slider')).toHaveCount(0)
  })

  test('нажатие проходит цикл «в процессе» → подтверждено, без оптимизма', async ({ page }) => {
    await enterRoom(page)

    const light = page.getByTestId('room-control-light.bedroom')
    await expect(light).toBeVisible({ timeout: 20_000 })
    const before = await light.getAttribute('aria-pressed')

    await light.click()

    // «В процессе» — и элемент заблокирован: состояние ещё не изменилось.
    // Именно этого не было бы при оптимистичном переключении.
    await expect(page.getByTestId('room-running-light.bedroom')).toBeVisible({ timeout: 10_000 })
    await expect(light).toBeDisabled()

    // Подтверждение приходит КАНАЛОМ, без перезагрузки страницы.
    await expect
      .poll(async () => light.getAttribute('aria-pressed'), { timeout: 30_000 })
      .not.toBe(before)
    await expect(page.getByTestId('room-running-light.bedroom')).toHaveCount(0)
  })

  test('сцена не показывается «включённой» — состояния у неё нет', async ({ page }) => {
    await enterRoom(page)

    const scene = page.getByTestId('room-control-scene.night')
    await expect(scene).toBeVisible({ timeout: 20_000 })
    // aria-pressed у сцены не проставляется вовсе: подтверждать нечем.
    await expect(scene).not.toHaveAttribute('aria-pressed', /.*/)

    await scene.click()
    await expect(scene).not.toHaveAttribute('aria-pressed', /.*/)
  })

  test('термостат: уставка меняется стрелками с клавиатуры', async ({ page }) => {
    await enterRoom(page)

    const dial = page.getByTestId('room-thermostat-ac.1')
    await expect(dial).toBeVisible({ timeout: 20_000 })

    const spin = dial.locator('[role="spinbutton"]')
    // Диапазон приезжает С СЕРВЕРА: 16–32 на фронте не зашиты.
    await expect(spin).toHaveAttribute('aria-valuemin', '16')
    await expect(spin).toHaveAttribute('aria-valuemax', '32')

    const before = await spin.getAttribute('aria-valuenow')
    await spin.focus()
    await page.keyboard.press('ArrowUp')
    await expect
      .poll(async () => spin.getAttribute('aria-valuenow'), { timeout: 30_000 })
      .not.toBe(before)
  })

  test('арабский: направление меняется и экран не разъезжается', async ({ page }) => {
    await enterRoom(page)
    await expect(page.getByTestId('room-control-light.living')).toBeVisible({ timeout: 20_000 })

    await page.getByTestId('guest-language').click()
    await page.getByTestId('guest-language-ar').click()

    // Направление документа переключилось по-настоящему.
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dir), { timeout: 15_000 })
      .toBe('rtl')
    await expect(page.getByTestId('room-page')).toBeVisible()
    await expect(page.getByTestId('room-control-light.living')).toBeVisible({ timeout: 20_000 })

    // Горизонтального разъезда нет: в RTL он появляется ровно там, где вместо
    // логических свойств использованы left/right.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, 'экран номера уехал по горизонтали в RTL').toBeLessThanOrEqual(1)

    // Заголовки приехали на арабском — то есть локаль раздела полная.
    await expect(page.getByTestId('room-page')).not.toContainText('Управление номером')
  })

  test('связи нет — контролы блокируются и устаревшее не показывается', async ({ page }) => {
    await enterRoom(page)
    await expect(page.getByTestId('room-control-light.living')).toBeVisible({ timeout: 20_000 })

    // Обрываем ответ сервера на снапшот и отдаём честное «недоступно».
    await page.route('**/api/v1/guest/room/state', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          availability: 'unavailable',
          message: 'Управление номером временно недоступно. Пожалуйста, обратитесь на ресепшен.',
          checked_at: new Date().toISOString(),
          trust: 'room_scanned',
          can_command: true,
          zones: [],
        }),
      })
    })
    await page.reload()

    // Нейтральный баннер, НИ ОДНОГО значения и ни одного контрола.
    await expect(page.getByTestId('room-unavailable')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/ресепшен/i)).toBeVisible()
    await expect(page.locator('[data-testid^="room-control-"]')).toHaveCount(0)
    // Техническая причина гостю не показывается.
    await expect(page.getByText(/CONNECTOR|TIMEOUT|iRidi|Modbus/i)).toHaveCount(0)
  })

  /* ── План-двойник ───────────────────────────────────────────────────────── */

  test('план отрисован, зоны стоят там, где комнаты', async ({ page }) => {
    await enterRoom(page)
    const plate = page.getByTestId('room-plan')
    await expect(plate).toBeVisible({ timeout: 20_000 })

    // Кадр приезжает АДРЕСОМ с сервера, а не собирается на фронте.
    const src = await plate.locator('img').getAttribute('src')
    expect(src, 'плита без кадра').toMatch(/^https?:\/\//)

    const frame = (await plate.boundingBox())!
    const at = async (code: string) => {
      const box = (await page.getByTestId(`room-plan-zone-${code}`).boundingBox())!
      return { x: (box.x - frame.x) / frame.width, y: (box.y - frame.y) / frame.height }
    }

    // Взаимное расположение — то же, что на рендере: гостиная слева от
    // спальни, гардеробная и ванная внизу, ванная справа от гардеробной.
    // Абсолютные проценты не проверяем: они живут в конфигурации, и сторож,
    // повторяющий их числами, ломался бы на каждом новом типе номера.
    const [living, bedroom, wardrobe, bathroom] = await Promise.all([
      at('living'),
      at('bedroom'),
      at('wardrobe'),
      at('bathroom'),
    ])
    expect(living.x).toBeLessThan(bedroom.x)
    expect(wardrobe.y).toBeGreaterThan(living.y)
    expect(bathroom.x).toBeGreaterThan(wardrobe.x)

    // Зона — настоящая кнопка с состоянием, а не картинка с обработчиком.
    const zone = page.getByTestId('room-plan-zone-living')
    await expect(zone).toHaveAttribute('aria-pressed', /true|false/)
    await expect(zone).toHaveAttribute('aria-label', /.+/)
  })

  test('тап по комнате меняет зону только ПОСЛЕ подтверждения', async ({ page }) => {
    await enterRoom(page)
    const zone = page.getByTestId('room-plan-zone-bedroom')
    await expect(zone).toBeVisible({ timeout: 20_000 })
    const before = await zone.getAttribute('aria-pressed')

    await zone.click()

    // Пока идёт обмен: зона показывает это и НЕ переключается. Именно этого не
    // было бы при оптимистичном переключении — там она мигнула бы сразу.
    await expect(page.getByTestId('room-running-light.bedroom')).toBeVisible({ timeout: 10_000 })
    await expect(zone).toHaveAttribute('aria-busy', 'true')
    expect(await zone.getAttribute('aria-pressed'), 'зона переключилась до подтверждения').toBe(
      before,
    )

    await expect
      .poll(async () => zone.getAttribute('aria-pressed'), { timeout: 30_000 })
      .not.toBe(before)
    // Тумблер в списке следует за тем же состоянием: путь один, а не два.
    await expect(page.getByTestId('room-control-light.bedroom')).toHaveAttribute(
      'aria-pressed',
      String(before !== 'true'),
    )
  })

  test('оффлайн: план не показывает свет ни включённым, ни выключенным', async ({
    page,
    request,
  }) => {
    await enterRoom(page)
    await expect(page.getByTestId('room-plan')).toBeVisible({ timeout: 20_000 })

    // Настоящую геометрию берём из живого ответа: разметка комнаты остаётся
    // верной, врать может только свет на ней.
    const live = await roomStateFromApi(request)
    expect(live.plan, 'план не приехал — проверять нечего').toBeTruthy()

    await freezeState(page, {
      ...live,
      availability: 'unavailable',
      message: 'Управление номером временно недоступно. Пожалуйста, обратитесь на ресепшен.',
      zones: [],
    })
    await page.reload()

    await expect(page.getByTestId('room-plan')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('room-plan-neutral')).toBeVisible()
    await expect(page.getByText(/ресепшен/i).first()).toBeVisible()

    // КРИТИЧНОЕ: ни одна зона не утверждает ни «включено», ни «выключено»,
    // и нажать её нельзя.
    const zones = page.locator('[data-testid^="room-plan-zone-"]')
    await expect(zones).not.toHaveCount(0)
    for (const zone of await zones.all()) {
      await expect(zone).toBeDisabled()
      await expect(zone).not.toHaveAttribute('aria-pressed', /.*/)
    }
  })

  test('обе темы: плита остаётся тёмной, меняется обрамление', async ({ page }) => {
    await enterRoom(page)
    const plate = page.getByTestId('room-plan')
    await expect(plate).toBeVisible({ timeout: 20_000 })

    const look = () =>
      plate.evaluate((el) => {
        const style = getComputedStyle(el)
        return { background: style.backgroundColor, border: style.borderColor }
      })

    const dark = await look()
    await page.getByTestId('theme-toggle').first().click()
    await expect
      .poll(async () => (await look()).border, { timeout: 10_000 })
      .not.toBe(dark.border)
    const light = await look()

    // Плита — ФОТОГРАФИЯ, а не поверхность интерфейса: подложка та же в обеих
    // темах. Светлая плита означала бы, что в номере включили свет.
    expect(light.background).toBe(dark.background)
    const channels = light.background.match(/\d+/g)!.slice(0, 3).map(Number)
    expect(Math.max(...channels), 'плита посветлела вместе с темой').toBeLessThan(40)
  })

  test('RTL: план не зеркалится — это комната, а не раскладка', async ({ page }) => {
    await enterRoom(page)
    await expect(page.getByTestId('room-plan')).toBeVisible({ timeout: 20_000 })

    const layout = async () => {
      const frame = (await page.getByTestId('room-plan').boundingBox())!
      const one = async (code: string) => {
        const box = (await page.getByTestId(`room-plan-zone-${code}`).boundingBox())!
        return Number(((box.x - frame.x) / frame.width).toFixed(3))
      }
      return { living: await one('living'), bathroom: await one('bathroom') }
    }

    const ltr = await layout()

    await page.getByTestId('guest-language').click()
    await page.getByTestId('guest-language-ar').click()
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dir), { timeout: 15_000 })
      .toBe('rtl')
    await expect(page.getByTestId('room-plan')).toBeVisible({ timeout: 20_000 })

    const rtl = await layout()

    // Ванная не переезжает налево оттого, что интерфейс на арабском.
    expect(rtl.living, 'план зеркалится в RTL').toBeCloseTo(ltr.living, 2)
    expect(rtl.bathroom, 'план зеркалится в RTL').toBeCloseTo(ltr.bathroom, 2)
    expect(rtl.bathroom).toBeGreaterThan(rtl.living)
  })

  test('тип без плана: экран работает списком, без заглушек и битых картинок', async ({
    page,
    request,
  }) => {
    // Снимок без плана — ровно то, что отдаёт тип, у которого рендера нет.
    // Подменяем на клиенте, а не сносим план у демо-типа: соседние проверки
    // работают на том же стенде, и чинить его за собой пришлось бы вслепую.
    const live = await roomStateFromApi(request)
    delete live.plan
    await freezeState(page, live)

    await enterRoom(page)

    await expect(page.getByTestId('room-control-light.living')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('room-plan')).toHaveCount(0)
    // Ни рамки, ни заглушки: плана просто нет.
    await expect(page.locator('[data-testid^="room-plan-"]')).toHaveCount(0)
  })

  test('без доверия команда отклоняется, а форма PIN живёт на самом экране', async ({
    page,
    request,
  }) => {
    // Демо-вход — временное послабление MVP. Выключаем его, чтобы проверить
    // штатное поведение: без PIN команд нет.
    const staff = await request.post(`${API}/api/staff/auth/login`, {
      data: ADMIN,
      headers: { 'X-Hotel-Subdomain': HOTEL },
    })
    expect(staff.ok(), 'вход администратора отеля').toBeTruthy()
    const token = (await staff.json()).access
    const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }

    const off = await request.post(`${API}/api/v1/cms/grms/access/demo-entry`, {
      data: { enabled: false },
      headers,
    })
    expect(off.ok(), `выключение демо-входа -> ${off.status()}`).toBeTruthy()

    try {
      await enterRoom(page)

      // Форма ввода PIN — ЗДЕСЬ, а не редиректом в никуда.
      await expect(page.getByTestId('room-pin-panel')).toBeVisible({ timeout: 20_000 })

      // Состояние при этом видно: доверие ограничивает действия, а не просмотр.
      const light = page.getByTestId('room-control-light.living')
      await expect(light).toBeVisible()
      await expect(light).toBeDisabled()

      // Неверный код не пускает.
      await page.getByTestId('room-pin-input').fill('0000')
      await page.getByTestId('room-pin-submit').click()
      await expect(page.getByTestId('room-pin-panel')).toBeVisible()
      await expect(light).toBeDisabled()
    } finally {
      await request.post(`${API}/api/v1/cms/grms/access/demo-entry`, {
        data: { enabled: true },
        headers,
      })
    }
  })
})
