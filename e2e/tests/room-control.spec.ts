import { expect, test, type Page } from '@playwright/test'

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
