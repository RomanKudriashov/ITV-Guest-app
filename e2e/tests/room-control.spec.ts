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

/**
 * Свайп пальцем по горизонтали.
 *
 * С ПРОМЕЖУТОЧНЫМИ `touchmove`, а не «начал и отпустил»: лента едет за пальцем
 * и решает по пройденному пути, а жест без единого движения — это не свайп,
 * а долгое нажатие. Настоящий палец всегда даёт промежуточные события.
 */
async function swipe(page: Page, x: number, y: number, dx: number): Promise<void> {
  await page.evaluate(
    ([startX, startY, deltaX]) => {
      const target = document.elementFromPoint(startX, startY)
      if (!target) throw new Error('свайпать не по чему')
      const fire = (type: string, clientX: number) => {
        const point = new Touch({ identifier: 1, target, clientX, clientY: startY })
        target.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === 'touchend' ? [] : [point],
            targetTouches: type === 'touchend' ? [] : [point],
            changedTouches: [point],
          }),
        )
      }
      fire('touchstart', startX)
      for (let step = 1; step <= 6; step += 1) fire('touchmove', startX + (deltaX * step) / 6)
      fire('touchend', startX + deltaX)
    },
    [x, y, dx] as const,
  )
}

test.describe('Управление номером', () => {
  test('пункт «Номер» ведёт на экран с живым состоянием из feedback', async ({ page }) => {
    await enterRoom(page)

    // Значения приезжают из ОБОРУДОВАНИЯ до первого взаимодействия, а не из
    // конфигурации: элемент, который не прочитали, был бы «нет связи».
    const light = page.getByTestId('room-control-light.living')
    await expect(light).toBeVisible({ timeout: 20_000 })
    await expect(light).toHaveAttribute('aria-pressed', /true|false/, { timeout: 20_000 })

    // Управление сгруппировано ПО ТИПУ: свет к свету, климат к климату.
    // Раньше здесь проверялись секции-комнаты — их не стало вместе с
    // группировкой по комнатам, а не вместе с проверкой.
    await expect(page.getByTestId('room-panel-light')).toBeVisible()
    await expect(page.getByTestId('room-control-light.bedroom')).toBeVisible()

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

    // Идёт обмен — и элемент заблокирован. Состояние при этом ОСТАЁТСЯ
    // прежним: ни желаемым (оптимизм), ни выключенным (так было до G5c —
    // сервер в полёте значений не отдаёт, а список их не помнил).
    await expect(light).toHaveAttribute('aria-busy', 'true', { timeout: 10_000 })
    await expect(light).toBeDisabled()
    expect(await light.getAttribute('aria-pressed'), 'состояние подменили на время обмена').toBe(
      before,
    )

    // Подтверждение приходит КАНАЛОМ, без перезагрузки страницы.
    await expect
      .poll(async () => light.getAttribute('aria-pressed'), { timeout: 30_000 })
      .not.toBe(before)
    await expect(light).not.toHaveAttribute('aria-busy', /.*/)
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

  test('сцена отвечает гостю: команда ушла и оборудование её приняло', async ({ page }) => {
    /*
      Сцены «не работали» ровно здесь. Команда уходила, доезжала до
      оборудования и возвращалась с исходом «принято» — а обработчик исхода
      считал «принято» тем же, что «подтверждено», и СТИРАЛ единственную
      надпись, которую гость успевал увидеть. Через полсекунды экран выглядел
      так, будто нажатия не было.
    */
    await enterRoom(page)

    const scene = page.getByTestId('room-control-scene.night')
    await expect(scene).toBeVisible({ timeout: 20_000 })
    await scene.click()

    const notice = page.getByTestId('room-notice')
    await expect(notice).toBeVisible({ timeout: 20_000 })
    // Отклик держится и ПОСЛЕ прихода исхода, а не гаснет вместе с ним.
    await page.waitForTimeout(3_000)
    await expect(notice).toBeVisible()
    // И при этом сцена по-прежнему не притворяется включённой.
    await expect(scene).not.toHaveAttribute('aria-pressed', /.*/)
  })

  test('сцена меняет номер, а не только надпись', async ({ page }) => {
    /*
      Найдено на живом телефоне: «Ночь» отвечала «оборудование приняло
      команду», и номер оставался прежним — свет горит, шторы стоят. Причина
      была в ДЕМО-ОБОРУДОВАНИИ: эмулятор принимал команду сцены и не трогал ни
      одного канала, потому что у сцены нет feedback'а. На объекте сцену
      раскладывает контроллер.

      Здесь проверяется то, что видит гость: после сцены состояния каналов
      ПРИЕХАЛИ ДРУГИЕ — обычным перечитыванием feedback, без единого намёка на
      то, что сцена «включена».
    */
    await enterRoom(page)

    // Зажечь свет заранее, чтобы «Ночь» было чем гасить: иначе номер и так
    // тёмный, и проверка ничего не различает.
    const lamp = page.getByTestId('room-control-light.living')
    await expect(lamp).toBeVisible({ timeout: 20_000 })
    if ((await lamp.getAttribute('aria-pressed')) !== 'true') {
      await lamp.click()
      await expect(lamp).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 })
    }

    await page.getByTestId('room-control-scene.night').click()

    // Свет гаснет сам — командой по своему каналу никто не щёлкал.
    await expect(lamp).toHaveAttribute('aria-pressed', 'false', { timeout: 25_000 })
    // А сцена так и не притворилась включённой.
    await expect(page.getByTestId('room-control-scene.night')).not.toHaveAttribute(
      'aria-pressed',
      /.*/,
    )
  })

  test('метки света на плане: из конфигурации, тапом управляют, в оффлайне их нет', async ({
    page,
  }) => {
    await enterRoom(page)

    const markers = page.locator('[data-testid^="room-plan-marker-"]')
    await expect(markers.first()).toBeVisible({ timeout: 20_000 })

    // Метки берутся ИЗ payload.plan: сколько точек прислал сервер (минус точка
    // воздуха), столько и меток. Ни одна координата на фронте не задана.
    const points = await roomStateFromApi(page.request).then(
      (state) => ((state.plan as { points?: unknown[] } | undefined)?.points ?? []) as unknown[],
    )
    const lightPoints = points.filter(
      (point) => !String((point as { controlId: string }).controlId).startsWith('ac.'),
    )
    expect(await markers.count()).toBe(lightPoints.length)

    // Тап по метке управляет тем же элементом, что и тумблер в списке.
    const marker = page.getByTestId('room-plan-marker-light.living')
    const before = await marker.getAttribute('data-on')
    await marker.click()
    await expect
      .poll(async () => marker.getAttribute('data-on'), { timeout: 30_000 })
      .not.toBe(before)

    const row = page.getByTestId('room-control-light.living')
    await expect(row).toHaveAttribute('aria-pressed', String(before !== 'true'))

    // Возвращаем как было — стенд общий.
    await marker.click()
    await expect.poll(async () => marker.getAttribute('data-on'), { timeout: 30_000 }).toBe(before)
  })

  test('на экране нет ни одного контрола, которого нет в железе', async ({ page }) => {
    /*
      СТОРОЖ КОРНЯ ЧЕСТНОСТИ ПРОЕКТА.

      В утверждённом референсе нарисовано то, чего на объекте не существует:
      ползунок яркости и цвет света (свет БИНАРНЫЙ, диммера нет), влажность,
      качество воздуха и уровень шума (датчиков нет), проценты и пресеты шторы
      (только открыть/закрыть), режимы кондиционера (не используются).
      Нарисованный ползунок яркости на объекте не сделает НИЧЕГО — и об этом
      узнает гость, а не мы.

      Тест смотрит на живой экран целиком, включая все вкладки: сторож на один
      компонент пропустил бы то же самое, добавленное в соседний.
    */
    await enterRoom(page)
    await expect(page.getByTestId('room-page')).toBeVisible({ timeout: 20_000 })

    const tabs = page.getByRole('tab')
    const count = await tabs.count()
    let text = ''
    for (let index = 0; index < Math.max(count, 1); index += 1) {
      if (count) {
        await tabs.nth(index).click()
        await page.waitForTimeout(400)
      }
      text += ' ' + ((await page.getByTestId('room-page').innerText()) ?? '')
      // Ползунков на экране номера быть не должно нигде, кроме шкалы уставки
      // термостата: она и есть единственный диапазон, который умеет железо.
      const sliders = page.getByTestId('room-page').getByRole('slider')
      for (const slider of await sliders.all()) {
        const label = (await slider.getAttribute('aria-label')) ?? ''
        const testId = (await slider.getAttribute('data-testid')) ?? ''
        const inThermostat = await slider
          .locator('xpath=ancestor::*[starts-with(@data-testid, "room-thermostat")]')
          .count()
        expect(
          inThermostat > 0,
          `посторонний ползунок на экране: ${testId || label}`,
        ).toBeTruthy()
      }
    }

    const forbidden = [
      /яркост/i,
      /brightness/i,
      /влажност/i,
      /humidity/i,
      /\bAQI\b/,
      /уровень шума/i,
      /охлаждени[ея]/i,
      /обогрев/i,
      /осушени/i,
      /вентиляци/i,
    ]
    for (const pattern of forbidden) {
      expect(text, `на экране появилось «${pattern}» — этого нет в железе`).not.toMatch(pattern)
    }
  })

  test('пилюли: активные состояния золотые, зелёного тона нет', async ({ page }) => {
    await enterRoom(page)

    const pills = page.locator('[data-testid^="room-pill-"]')
    await expect(pills.first()).toBeVisible({ timeout: 20_000 })

    const tones = await pills.evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset.tone ?? ''),
    )
    expect(tones.length).toBeGreaterThan(0)
    // Тонов ровно три: холодный (термометр), активный (золото) и нейтральный.
    expect(tones.every((tone) => ['cold', 'active', 'neutral'].includes(tone))).toBeTruthy()

    // Порядок — это приоритет: температура, свет, шторы, блэкаут, уборка, «не
    // беспокоить». Ряд один и прокручивается, поэтому важно, что гость видит
    // первым, не прокручивая.
    const order = await pills.evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset.testid ?? ''),
    )
    const rank = [
      'room-pill-temp',
      'room-pill-lit',
      'room-pill-curtain',
      'room-pill-blackout',
      'room-pill-cleaning',
      'room-pill-dnd',
    ]
    const positions = order.map((id) => rank.indexOf(id))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  test('пилюли блэкаута и уборки появляются по состоянию и уходят вместе с ним', async ({
    page,
  }) => {
    await enterRoom(page)

    const blackout = page.getByTestId('room-control-curtain.blackout')
    await expect(blackout).toBeVisible({ timeout: 20_000 })

    // Пилюля блэкаута — про ЗАКРЫТО: открытый блэкаут ничего не сообщает.
    const wasOpen = (await blackout.getAttribute('aria-pressed')) === 'true'
    if (wasOpen) {
      await blackout.click()
      await expect(page.getByTestId('room-pill-blackout')).toBeVisible({ timeout: 30_000 })
      await blackout.click()
      await expect(page.getByTestId('room-pill-blackout')).toBeHidden({ timeout: 30_000 })
    } else {
      await expect(page.getByTestId('room-pill-blackout')).toBeVisible({ timeout: 30_000 })
      await blackout.click()
      await expect(page.getByTestId('room-pill-blackout')).toBeHidden({ timeout: 30_000 })
      await blackout.click()
    }
  })

  test('быстрые действия ведут в существующие разделы витрины', async ({ page }) => {
    /*
      Блок — МОСТ в то, что уже есть, а не новая сущность. Проверяем это по
      результату: кнопка уводит на существующий маршрут витрины, и там
      открывается настоящий экран, а не заглушка.

      Уборки среди кнопок нет намеренно: она живёт элементом номера (MUR) в
      панели «Сервис», и второй способ попросить её означал бы два источника
      правды об одном и том же.
    */
    await enterRoom(page)

    const quick = page.getByTestId('room-quick-actions')
    await expect(quick).toBeVisible({ timeout: 20_000 })

    const chat = page.getByTestId('room-quick-chat')
    if (await chat.count()) {
      await chat.click()
      await expect(page).toHaveURL(/\/chat/)
      await expect(page.getByTestId('guest-chat')).toBeVisible({ timeout: 15_000 })
    }
  })

  test('термостат: уставка меняется стрелками с клавиатуры', async ({ page }) => {
    await enterRoom(page)

    const dial = page.getByTestId('room-thermostat-ac.1')
    await expect(dial).toBeVisible({ timeout: 20_000 })

    const spin = dial.locator('[role="slider"]')
    // Диапазон приезжает С СЕРВЕРА: 16–32 на фронте не зашиты.
    await expect(spin).toHaveAttribute('aria-valuemin', '16')
    await expect(spin).toHaveAttribute('aria-valuemax', '32')

    const before = await spin.getAttribute('aria-valuenow')
    await spin.focus()
    // Направление выбирается от текущего значения: стенд общий, и предыдущие
    // прогоны могли оставить уставку на краю диапазона — вверх с 32° она не
    // поедет, и тест мерил бы упор, а не клавиатуру.
    await page.keyboard.press(before === '32' ? 'ArrowDown' : 'ArrowUp')
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

    // Локаль раздела полная: название раздела «Свет» приехало на арабском.
    // Проверка переехала с заголовка страницы на название панели — заголовка
    // в макете нет, а вопрос «перевелось ли» остался тем же. Берём вкладку
    // или заголовок панели: прогон идёт на десктопной ширине, где вкладок нет.
    const sectionLabel = (await page.getByTestId('room-tabs-light').count())
      ? page.getByTestId('room-tabs-light')
      : page.getByTestId('room-panel-light').locator('h2')
    await expect(sectionLabel).not.toHaveText('Свет')
    await expect(sectionLabel).toHaveText(/[\u0600-\u06FF]/)
  })

  test('связи нет — раскладка остаётся, но ни одного значения', async ({ page }) => {
    /*
      РАСКЛАДКА ПЕРЕЖИВАЕТ ОБРЫВ, ЧЕСТНОСТЬ — ТОЖЕ.

      Раньше экран схлопывался в заглушку: сервер, когда оборудование молчит
      долго, не присылает ни зон, ни элементов. Выглядело это поломкой
      приложения. Теперь последняя известная СТРУКТУРА остаётся — названия,
      строки, план, — а состояния гаснут и контролы блокируются. Значения при
      этом не переносятся: устаревшее не выдаётся за текущее.
    */
    // Живой сокет отключаем: снимок должен приходить одним путём, иначе
    // проверяем не обрыв, а гонку двух источников.
    await page.routeWebSocket(/\/ws\/v1\/guest\/room/, (ws) => ws.close())
    await enterRoom(page)
    await expect(page.getByTestId('room-control-light.living')).toBeVisible({ timeout: 20_000 })

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
    // Уходим и возвращаемся — так гость и делает: заглянул в чат, вернулся в
    // номер. Структура при этом не забывается, а состояния приезжают новые.
    await page.getByTestId('guest-nav-chat').click()
    await page.getByTestId('guest-nav-room').click()

    const row = page.getByTestId('room-control-light.living')
    await expect(row).toContainText(/нет связи/i, { timeout: 30_000 })

    // Раскладка на месте: строка, её название и план никуда не делись.
    await expect(row).toBeVisible()
    await expect(row).toContainText(/свет в гостиной/i)
    await expect(page.getByTestId('room-plan')).toBeVisible()
    // Управлять нечем: строка заблокирована целиком.
    await expect(row).toBeDisabled()
    // Техническая причина гостю не показывается.
    await expect(page.getByText(/CONNECTOR|TIMEOUT|iRidi|Modbus/i)).toHaveCount(0)
  })

  test('связи нет с первого открытия — честная заглушка', async ({ page }) => {
    /*
      Показывать нечего и вспомнить нечего: гость открыл номер, когда канал уже
      молчал. Придумывать структуру мы не станем — остаётся баннер сервера.
    */
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
    await enterRoom(page)

    await expect(page.getByTestId('room-unavailable')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/ресепшен/i)).toBeVisible()
    await expect(page.locator('[data-testid^="room-control-"]')).toHaveCount(0)
    await expect(page.getByText(/CONNECTOR|TIMEOUT|iRidi|Modbus/i)).toHaveCount(0)
  })

  /* ── План-двойник ───────────────────────────────────────────────────────── */

  test('план отрисован, зоны стоят там, где комнаты', async ({ page }) => {
    await enterRoom(page)
    const plate = page.getByTestId('room-plan')
    await expect(plate).toBeVisible({ timeout: 20_000 })

    // Кадр приезжает АДРЕСОМ с сервера, а не собирается на фронте.
    const src = await page.getByTestId('room-plan-base').getAttribute('src')
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

  test('плита — два совмещённых кадра: ночной снизу, светлый по включённым зонам', async ({
    page,
    request,
  }) => {
    const live = await roomStateFromApi(request)
    const plan = live.plan as { image: string; image_off: string }
    expect(plan.image_off, 'ночной кадр не приехал — проверять нечего').toBeTruthy()
    expect(plan.image_off).not.toBe(plan.image)

    await enterRoom(page)
    const plate = page.getByTestId('room-plan')
    await expect(plate).toBeVisible({ timeout: 20_000 })

    // Снизу ВСЕГДА ночной кадр: выключенная зона показывает настоящую тёмную
    // комнату, а не дневную под серой плёнкой.
    await expect(page.getByTestId('room-plan-base')).toHaveAttribute('src', plan.image_off)

    // Светлый кадр — окном по каждой зоне, и окно видно ровно тогда, когда
    // свет в этой зоне подтверждён.
    for (const code of ['living', 'bedroom', 'entry', 'wardrobe', 'bathroom']) {
      // Светлый кадр лежит ЦЕЛИКОМ поверх ночного, а видно его в окне зоны:
      // отдельного контейнера с обрезкой больше нет — на живом iOS обрезка
      // съедала маску и зона выходила жёстким прямоугольником.
      const lit = page.getByTestId(`room-plan-lit-${code}`)
      await expect(lit).toHaveAttribute('src', plan.image)
      const pressed = await page.getByTestId(`room-plan-zone-${code}`).getAttribute('aria-pressed')
      await expect
        .poll(async () => lit.evaluate((el) => getComputedStyle(el).opacity), { timeout: 5_000 })
        .toBe(pressed === 'true' ? '1' : '0')
    }
  })

  test('тап по комнате меняет зону только ПОСЛЕ подтверждения', async ({ page }) => {
    await enterRoom(page)
    const zone = page.getByTestId('room-plan-zone-bedroom')
    await expect(zone).toBeVisible({ timeout: 20_000 })
    const before = await zone.getAttribute('aria-pressed')

    /*
      НЕ В ЦЕНТР ЗОНЫ, И ЭТО НЕ ПОДГОНКА.

      Метка лампы по замыслу стоит В СЕРЕДИНЕ своей зоны (см. `lights` в
      plan-geometry.json), то есть ровно там, куда Playwright бьёт по
      умолчанию. Раньше клик проходил только потому, что при тогдашней ширине
      плиты центр зоны расходился с меткой на СЕМЬ ДЕСЯТЫХ пикселя: любое
      изменение раскладки — и он попадал в метку.

      Гостю это не мешает: метка переключает тот же свет тем же обработчиком.
      А проверка здесь про другое — что зона не мигает до подтверждения, — и
      зависеть от одного пикселя она не должна. Поэтому бьём в верхнюю часть
      зоны, свободную от метки.
    */
    await zone.click({ position: { x: 40, y: 12 } })

    // Пока идёт обмен: зона показывает это и НЕ переключается. Именно этого не
    // было бы при оптимистичном переключении — там она мигнула бы сразу.
    await expect(page.getByTestId('room-control-light.bedroom')).toHaveAttribute(
      'aria-busy',
      'true',
      { timeout: 10_000 },
    )
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
    // И светлый кадр по этой комнате появился (или ушёл) вместе с состоянием.
    await expect
      .poll(
        async () =>
          page.getByTestId('room-plan-lit-bedroom').evaluate((el) => getComputedStyle(el).opacity),
        { timeout: 10_000 },
      )
      .toBe(before !== 'true' ? '1' : '0')
  })

  test('телефон: вкладки переключаются тапом и свайпом', async ({ page }) => {
    // Прогон идёт на десктопной ширине, где вкладок нет вовсе: сужаемся
    // внутри теста, а не заводим второй контекст — два контекста сразу это
    // тот самый известный флейк.
    await page.setViewportSize({ width: 390, height: 844 })
    await enterRoom(page)
    await expect(page.getByTestId('room-tabs')).toBeVisible({ timeout: 20_000 })

    // Стартуем со света: панель одна, а не все сразу.
    await expect(page.getByTestId('room-panel-light')).toBeVisible()
    await expect(page.getByTestId('room-panel-climate')).toHaveCount(0)

    // Тап.
    await page.getByTestId('room-tabs-climate').click()
    await expect(page.getByTestId('room-panel-climate')).toBeVisible()
    await expect(page.getByTestId('room-panel-light')).toHaveCount(0)
    await expect(page.getByTestId('room-tabs-climate')).toHaveAttribute('aria-selected', 'true')

    // Свайп влево — следующая вкладка.
    const panel = await page.getByTestId('room-panel-climate').boundingBox()
    await swipe(page, panel!.x + panel!.width - 20, panel!.y + 8, -180)
    await expect(page.getByTestId('room-panel-curtain')).toBeVisible()

    // И вправо — обратно.
    const back = await page.getByTestId('room-panel-curtain').boundingBox()
    await swipe(page, back!.x + 20, back!.y + 8, 180)
    await expect(page.getByTestId('room-panel-climate')).toBeVisible()
  })

  test('уставка: серия нажатий даёт ОДНУ команду, число едет сразу', async ({ page }) => {
    const commands: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/guest/room/command') && request.method() === 'POST') {
        commands.push(String(request.postData()))
      }
    })

    await enterRoom(page)
    const dial = page.getByTestId('room-thermostat-ac.1')
    await expect(dial).toBeVisible({ timeout: 20_000 })
    const spin = dial.locator('[role="slider"]')
    const before = Number(await spin.getAttribute('aria-valuenow'))
    // Направление от текущего значения: стенд общий, уставка могла остаться
    // на краю диапазона, и упор в край мерил бы не то.
    const up = before < 28
    const step = page.getByTestId(`room-thermostat-ac.1-${up ? 'plus' : 'minus'}`)

    commands.length = 0
    for (let i = 0; i < 5; i += 1) await step.click()

    // Число под пальцем едет СРАЗУ, не дожидаясь оборудования: это запрос
    // гостя, и он подписан «отправляем уставку».
    await expect(spin).toHaveAttribute('aria-valuenow', String(before + (up ? 5 : -5)))
    await expect(page.getByTestId('room-thermostat-ac.1-hint')).toHaveText(/./)
    expect(commands.length, 'команда ушла до того, как гость закончил крутить').toBe(0)

    // И ровно ОДНА команда — с последним значением. Раньше их уходило пять,
    // из которых четыре отбивались дедупом как «предыдущее ещё выполняется».
    await expect.poll(() => commands.length, { timeout: 5_000 }).toBe(1)
    expect(commands[0]).toContain(`"value":${before + (up ? 5 : -5)}`)
  })

  test('телефон: сжатие плиты не меняет высоту документа', async ({ page }) => {
    // Прогон идёт на десктопной ширине, где плита не сжимается вовсе.
    await page.setViewportSize({ width: 390, height: 844 })
    await enterRoom(page)
    await expect(page.getByTestId('room-plan')).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(1500)

    const scaleAt = async (y: number) => {
      await page.evaluate((to) => window.scrollTo(0, to), y)
      await page.waitForTimeout(150)
      return page.evaluate(() => ({
        height: document.body.scrollHeight,
        scale: getComputedStyle(document.querySelector('[data-testid="room-plan"]')!).transform,
      }))
    }

    const probes = []
    for (const y of [0, 60, 120, 200, 400, 200, 60, 0]) probes.push(await scaleAt(y))

    // Высота документа при скролле не меняется ВООБЩЕ. Именно её изменение
    // заводило петлю: сжали плиту → изменилась высота → браузер поправил
    // позицию скролла → пересчитали сжатие → экран затрясся.
    const heights = [...new Set(probes.map((p) => p.height))]
    expect(heights.length, `высота документа гуляет: ${heights.join(', ')}`).toBe(1)

    // При этом плита действительно сжимается и возвращается.
    const scaleOf = (value: string) => Number((value.match(/matrix\(([\d.]+)/) ?? [, '1'])[1])
    expect(scaleOf(probes[0].scale)).toBeCloseTo(1, 2)
    /*
      Сжалась — и осталась читаемой. Прежний порог «меньше 0.64» описывал не
      правило, а конкретную глубину: на ней план превращался в марку, и глубину
      подняли. Правило же остаётся прежним: при скролле плита уменьшается, а
      при возврате наверх — восстанавливается.
    */
    expect(scaleOf(probes[4].scale)).toBeLessThan(0.95)
    expect(scaleOf(probes[4].scale)).toBeGreaterThanOrEqual(0.7)
    expect(scaleOf(probes[probes.length - 1].scale)).toBeCloseTo(1, 2)
  })

  test('телефон: плита не съедает управление, а обрезка не двигает разметку', async ({
    page,
  }) => {
    /**
     * Разметка ОТНОСИТЕЛЬНО КАДРА, а не относительно плиты.
     *
     * Плита на телефоне упирается в потолок высоты и обрезает кадр снизу;
     * кадр при этом остаётся полной высоты отдельным слоем. Стоит начать
     * считать проценты от плиты — и зоны, окна и метки поедут относительно
     * картинки ровно в тот момент, когда обрезка включится, причём тем
     * сильнее, чем ниже экран.
     */
    const layout = async () => {
      const plate = (await page.getByTestId('room-plan').boundingBox())!
      const frame = (await page.getByTestId('room-plan-frame').boundingBox())!
      const at = async (testId: string) => {
        const box = (await page.getByTestId(testId).boundingBox())!
        return {
          x: Number(((box.x - frame.x) / frame.width).toFixed(3)),
          y: Number(((box.y - frame.y) / frame.height).toFixed(3)),
          bottom: box.y + box.height,
        }
      }
      return {
        plate,
        frame,
        zones: {
          living: await at('room-plan-zone-living'),
          bedroom: await at('room-plan-zone-bedroom'),
          bathroom: await at('room-plan-zone-bathroom'),
        },
        windows: { top: await at('room-plan-window-win-living-top') },
        markers: {
          living: await at('room-plan-marker-light.living'),
          entry: await at('room-plan-marker-light.entry'),
          bathroom: await at('room-plan-marker-light.bathroom'),
        },
      }
    }

    // Высокий экран: потолок не достаётся, кадр цел — это эталон разметки.
    await page.setViewportSize({ width: 390, height: 844 })
    await enterRoom(page)
    await expect(page.getByTestId('room-plan')).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(800)
    const tall = await layout()

    /*
      А это — живой телефон: 664 px видимой высоты у iPhone 12 в Safari,
      где над страницей стоит строка браузера. Именно здесь плита кадром
      1.056 отнимала у списка столько, что первая строка контролов уезжала
      под нижнюю навигацию.
    */
    await page.setViewportSize({ width: 390, height: 664 })
    await page.waitForTimeout(800)
    const short = await layout()

    // Обрезка действительно случилась, и по ВЫСОТЕ, а не по ширине. Ширина
    // при этом может отдать пару пикселей — на дне обрезки потолок начинает
    // сужать плиту, — но не десятки: сузься она всерьёз, кадр бы уже не
    // обрезался, а уменьшался целиком, и смысл потолка потерялся бы.
    expect(short.plate.height, 'плита не обрезалась').toBeLessThan(short.frame.height - 4)
    expect(short.plate.width, 'обрезали ширину вместо высоты').toBeGreaterThan(
      tall.plate.width * 0.97,
    )

    // …а разметка не шелохнулась: доли КАДРА те же, что на целом кадре.
    for (const key of ['living', 'bedroom', 'bathroom'] as const) {
      expect(short.zones[key].x, `зона ${key} уехала по X`).toBeCloseTo(tall.zones[key].x, 2)
      expect(short.zones[key].y, `зона ${key} уехала по Y`).toBeCloseTo(tall.zones[key].y, 2)
    }
    expect(short.windows.top.y, 'окно уехало относительно кадра').toBeCloseTo(tall.windows.top.y, 2)
    for (const key of ['living', 'entry', 'bathroom'] as const) {
      expect(short.markers[key].y, `метка ${key} уехала относительно кадра`).toBeCloseTo(
        tall.markers[key].y,
        2,
      )
    }

    // Обрезано снизу: ни одна метка не повисла полукруглым огрызком на краю.
    const plateBottom = short.plate.y + short.plate.height
    for (const [key, marker] of Object.entries(short.markers)) {
      expect(marker.bottom, `метка ${key} вылезла за обрез плиты`).toBeLessThanOrEqual(
        plateBottom + 1,
      )
    }

    /*
      АЛЬБОМНАЯ ОРИЕНТАЦИЯ — ДНО ОБРЕЗКИ.

      Тут потолок высоты требовал бы оставить от кадра около 39%: верхнюю
      полосу комнаты с двумя лампами из пяти, а нижний ряд меток повис бы
      половинками на самом обрезе. Дойдя до дна, потолок перестаёт обрезать и
      начинает сужать плиту — кадр снова помещается целиком, пусть и мельче.
    */
    await page.setViewportSize({ width: 844, height: 390 })
    await page.waitForTimeout(800)
    const wide = await layout()
    expect(wide.plate.width, 'плита в альбомной не сузилась').toBeLessThan(short.plate.width)
    expect(
      wide.plate.height / wide.frame.height,
      'от кадра осталась полоса — дно обрезки не сработало',
    ).toBeGreaterThan(0.8)
    const wideBottom = wide.plate.y + wide.plate.height
    for (const [key, marker] of Object.entries(wide.markers)) {
      expect(marker.bottom, `метка ${key} вылезла за обрез в альбомной`).toBeLessThanOrEqual(
        wideBottom + 1,
      )
    }
    for (const key of ['living', 'bedroom', 'bathroom'] as const) {
      expect(wide.zones[key].y, `зона ${key} уехала в альбомной`).toBeCloseTo(tall.zones[key].y, 2)
    }

    await page.setViewportSize({ width: 390, height: 664 })
    await page.waitForTimeout(800)

    /*
      И ГЛАВНОЕ: до первой строки контролов можно дотянуться пальцем, не
      прокручивая. Проверяем не координатами, а тем же вопросом, который
      задаёт себе браузер по нажатию, — кто лежит в этой точке. Раньше здесь
      оказывалась нижняя навигация, и тап уходил ей.
     */
    const first = page.locator('[data-testid^="room-control-"]').first()
    await expect(first).toBeVisible()
    const row = (await first.boundingBox())!
    const under = await page.evaluate(
      ([x, y]) =>
        document
          .elementFromPoint(x, y)
          ?.closest('[data-testid]')
          ?.getAttribute('data-testid') ?? null,
      [row.x + row.width / 2, row.y + row.height / 2],
    )
    expect(under, 'до первой строки контролов не дотянуться').toMatch(/^room-control-/)
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
    // Плита не считает горящие зоны, а честно говорит, что не знает.
    await expect(page.getByTestId('room-plan')).toHaveAttribute('data-lit', 'unknown')

    // Показан ЦЕЛИКОМ ночной кадр: ни одного окна светлого поверх него.
    await expect(page.getByTestId('room-plan-base')).toHaveAttribute(
      'src',
      (live.plan as { image_off: string }).image_off,
    )
    for (const code of ['living', 'bedroom', 'entry', 'wardrobe', 'bathroom']) {
      await expect(
        page.getByTestId(`room-plan-lit-${code}`),
        `зона ${code} показывает свет в оффлайне`,
      ).toHaveCSS('opacity', '0')
    }

    // КРИТИЧНОЕ: ни одна зона не утверждает ни «включено», ни «выключено»,
    // и нажать её нельзя.
    const zones = page.locator('[data-testid^="room-plan-zone-"]')
    await expect(zones).not.toHaveCount(0)
    for (const zone of await zones.all()) {
      await expect(zone).toBeDisabled()
      await expect(zone).not.toHaveAttribute('aria-pressed', /.*/)
    }
  })

  test('обе темы: плита светлеет вместе с темой, но выключенное темнее включённого', async ({ page }) => {
    await enterRoom(page)
    const plate = page.getByTestId('room-plan')
    await expect(plate).toBeVisible({ timeout: 20_000 })

    /*
      ПРАВИЛО ИЗМЕНИЛОСЬ, И ЭТО ОСОЗНАННО.

      Раньше здесь проверялось обратное: «плита остаётся тёмной в обеих темах,
      потому что это фотография, а не поверхность интерфейса». Довод был про
      честность — светлая плита читалась бы как «в номере включили свет».

      Что этот довод не учитывал: ночной кадр в среднем 27 из 255, и на белой
      странице он читается не как ночь, а как чёрная дыра, выпадающая из темы.
      Настоящая комната днём с выключенным светом тоже светлая — тёмной её
      делает ночь, а не выключатель.

      Поэтому теперь кадры поднимаются экспозицией под тему, а честность
      обеспечивает ИНВАРИАНТ, который и проверяется ниже: выключенный свет
      обязан быть темнее включённого — в любой теме. Поднимать один ночной
      кадр было нельзя ровно поэтому: светлый кадр в среднем 54, и ночной,
      поднятый до «дневного» уровня, оказался бы ЯРЧЕ него.
    */
    const exposure = () =>
      plate.evaluate((el) => {
        const style = (node: Element | null) => (node ? getComputedStyle(node).filter : '');
        const brightness = (value: string) => {
          const match = value.match(/brightness\(([\d.]+)\)/);
          return match ? Number(match[1]) : 1;
        };
        const off = style(el.querySelector('[data-testid="room-plan-base"]'));
        const on = style(el.querySelector('[data-testid^="room-plan-lit-"]'));
        return {
          off,
          on,
          offBrightness: brightness(off),
          onBrightness: brightness(on),
          backdrop: getComputedStyle(el).backgroundColor,
        };
      })

    const dark = await exposure()
    // Тёмная тема: кадры показываются как сняты, поднимать нечего.
    expect(dark.off).toBe('none')
    expect(dark.on).toBe('none')

    await page.getByTestId('theme-toggle').first().click()
    await expect
      .poll(async () => (await exposure()).backdrop, { timeout: 10_000 })
      .not.toBe(dark.backdrop)
    const light = await exposure()

    // Светлая тема: подняты ОБА кадра, иначе плита врёт про свет.
    expect(light.off).not.toBe('none')
    expect(light.on).not.toBe('none')
    expect(light.offBrightness).toBeGreaterThan(dark.offBrightness)
    expect(
      light.offBrightness * 1.15,
      'ночной кадр поднят почти как светлый — разрыв между включено и выключено съеден',
    ).toBeGreaterThan(light.onBrightness)

    // Подложка плиты светлеет вместе с темой: чёрный прямоугольник, мигающий
    // до загрузки кадра, — та же дыра на белой странице.
    const channels = light.backdrop.match(/\d+/g)!.slice(0, 3).map(Number)
    expect(Math.max(...channels), 'подложка плиты осталась тёмной').toBeGreaterThan(120)
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

  test('prefers-reduced-motion: движения нет, состояния читаются', async ({ page }) => {
    // Режим включаем на странице, а не опцией контекста: `test.use` завёл бы
    // отдельный контекст, а один контекст на файл здесь — осознанное
    // ограничение, а не случайность.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await enterRoom(page)
    const plate = page.getByTestId('room-plan')
    await expect(plate).toBeVisible({ timeout: 20_000 })

    // Через poll: медиазапрос подхватывается после первого кадра, и
    // мгновенная проверка ловила бы этот кадр, а не режим.
    await expect
      .poll(
        async () =>
          plate.evaluate(
            (el) =>
              [el, ...Array.from(el.querySelectorAll<HTMLElement>('*'))].filter(
                (node) => parseFloat(getComputedStyle(node).transitionDuration) > 0,
              ).length,
          ),
        { timeout: 10_000, message: 'на плите остались анимации' },
      )
      .toBe(0)

    // Гасим движение, а не смысл: зона по-прежнему говорит своё состояние.
    await expect(page.getByTestId('room-plan-zone-living')).toHaveAttribute(
      'aria-pressed',
      /true|false/,
    )
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

/**
 * ОБВОДКА ЗОНЫ — ПРИЗНАК ВЗАИМОДЕЙСТВИЯ, А НЕ ВЫБОРА.
 *
 * Отдельный блок ради тач-контекста: на десктопной мыши симптома не видно —
 * рамка снималась следующим наведением, и залипание было заметно только там,
 * где указателю некуда уйти. Контекст здесь свой, но не второй одновременный:
 * блоки идут последовательно, а именно одновременность и роднила известные
 * флейки.
 */
test.describe('План: обводка зоны', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  /** Обводка читается вычисленным стилем — тем же, что видит гость. */
  const ringOf = (zone: ReturnType<Page['getByTestId']>) =>
    zone.evaluate((el) => getComputedStyle(el).boxShadow)

  const RING = 'rgba(227, 178, 60'

  test('тап пальцем: обводка держится, пока идёт команда, и уходит с исходом', async ({
    page,
  }) => {
    await enterRoom(page)
    const zone = page.getByTestId('room-plan-zone-bedroom')
    await expect(zone).toBeVisible({ timeout: 20_000 })
    await expect(zone).toHaveAttribute('aria-pressed', /true|false/, { timeout: 20_000 })
    expect(await ringOf(zone), 'до касания обводки быть неоткуда').toBe('none')

    /*
      Палец ставим В САМУ ЗОНУ, а не в её середину: посередине комнаты лежит
      метка света — она мельче зоны и перехватывает нажатие. Тап по центру
      уходил бы метке, и проверка обводки зоны стала бы проверкой ни о чём.
    */
    const box = (await zone.boundingBox())!
    const x = box.x + box.width * 0.15
    const y = box.y + box.height * 0.2
    expect(
      await page.evaluate(
        ([px, py]) => document.elementFromPoint(px, py)?.getAttribute('data-testid'),
        [x, y],
      ),
      'палец должен попасть в зону, а не в метку',
    ).toBe('room-plan-zone-bedroom')
    await page.touchscreen.tap(x, y)

    // Пока палец на зоне, обводка — ответ на нажатие; здесь тап уже отпущен,
    // и дальше её держит только команда.

    // Палец уже убран, а обводка на месте: держит её команда в полёте.
    await expect(zone).toHaveAttribute('aria-busy', 'true', { timeout: 15_000 })
    expect(await ringOf(zone), 'команда идёт, а обводки нет').toContain(RING)

    // Исход пришёл — обводка снята. Раньше она оставалась висеть навсегда:
    // ставилась по нажатию и снималась только следующим наведением мыши,
    // которого на телефоне не бывает.
    await expect.poll(() => zone.getAttribute('aria-busy'), { timeout: 30_000 }).toBeNull()
    await expect
      .poll(() => ringOf(zone), { timeout: 5_000, message: 'обводка залипла после исхода' })
      .toBe('none')
  })

  test('неподтверждённый исход снимает обводку так же, как подтверждённый', async ({
    page,
    request,
  }) => {
    /*
      Исход приезжает КАНАЛОМ, им же и проверяем: сокет здесь наш, снимки в
      него кладём сами. Без этого «неподтверждённо» на живом стенде не
      воспроизвести — оборудование демо-номера отвечает подтверждением.
    */
    const live = await roomStateFromApi(request)
    const CONTROL = 'light.bedroom'
    const withState = (state: string) => ({
      ...live,
      zones: (live.zones as { controls: { controlId: string }[] }[]).map((zone) => ({
        ...zone,
        controls: zone.controls.map((control) =>
          control.controlId === CONTROL ? { ...control, state } : control,
        ),
      })),
    })

    let socket: { send: (data: string) => void } | null = null
    await page.routeWebSocket(/\/ws\/v1\/guest\/room/, (ws) => {
      socket = ws
    })
    await enterRoom(page)
    const zone = page.getByTestId('room-plan-zone-bedroom')
    await expect(zone).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => Boolean(socket), { timeout: 20_000 }).toBe(true)

    const push = async (state: string, command?: Record<string, unknown>) => {
      socket!.send(JSON.stringify({ type: 'room.snapshot', room: withState(state), command }))
    }

    // Команда в полёте — обводка есть, хотя пальца на экране нет.
    await push('pending')
    await expect
      .poll(() => ringOf(zone), { timeout: 10_000, message: 'команда идёт, а обводки нет' })
      .toContain(RING)

    // Оборудование не подтвердило. Значение остаётся прежним — это правило
    // экрана, — а обводка уходит: взаимодействие кончилось.
    await push('unconfirmed', { controlId: CONTROL, result: 'unconfirmed' })
    await expect
      .poll(() => ringOf(zone), {
        timeout: 10_000,
        message: 'после неподтверждённого исхода обводка осталась',
      })
      .toBe('none')
    await expect(page.getByTestId('room-notice')).toBeVisible()
  })
})
