import { expect, test } from '@playwright/test'

/**
 * СХЕМА АДРЕСОВ — экранная половина.
 *
 *   <корень>               лендинг платформы
 *   <корень>/admin         наша консоль
 *   <отель>.<корень>       гостевое приложение отеля
 *   <отель>.<корень>/admin CMS этого отеля
 *
 * ПОЧЕМУ ЗДЕСЬ ДРУГИЕ АДРЕСА. Остальной набор ходит на `localhost:5183`, где
 * делить хост на роли нечем — там режим одного хоста, как было всегда. Схема
 * живёт на именах `guest.localhost` и `crystal.guest.localhost`: они
 * разрешаются в петлю и браузером, и контейнером, поэтому проверять её можно
 * без wildcard-DNS и без домена. Базовый домен приезжает сборкой
 * (`VITE_APP_DOMAIN` в docker-compose.yml).
 *
 * Серверная половина — `backend/tests/core/test_address_scheme.py`: там
 * проверяется, что консоль не отвечает с адреса отеля запросом, а не только не
 * рисуется на экране.
 */

const PORT = process.env.E2E_FRONT_PORT ?? '5183'
const ROOT = `http://guest.localhost:${PORT}`
const HOTEL = `http://crystal.guest.localhost:${PORT}`

test('корень платформы: лендинг, а не гостевой вход', async ({ page }) => {
  await page.goto(`${ROOT}/`)
  await expect(page.getByTestId('landing')).toBeVisible({ timeout: 30_000 })

  // Поля номера комнаты здесь больше нет. Раньше оно стояло живым, а нажатие
  // отвечало ошибкой сервера «не удалось определить отель» — экран выглядел
  // рабочим и не работал.
  await expect(page.getByTestId('guest-room-input')).toHaveCount(0)
})

test('УКУС: с хоста отеля консоль не открывается, а /admin — это CMS отеля', async ({ page }) => {
  await page.goto(`${HOTEL}/admin`)

  // Вход CMS (`login-email`), а не вход консоли (`admin-login-email`).
  await expect(page.getByTestId('login-email')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('admin-login-email')).toHaveCount(0)
})

test('УКУС: старый адрес CMS ведёт на новый, с сохранением раздела', async ({ page }) => {
  await page.goto(`${HOTEL}/login`)
  await expect(page).toHaveURL(`${HOTEL}/admin`, { timeout: 30_000 })

  // Хвост адреса переносится: ссылка из письма ведёт в конкретный раздел, и
  // высадка в дашборд означала бы «адрес жив, но не тот».
  await page.goto(`${HOTEL}/cms/services?tab=menu`)
  await expect(page).toHaveURL(`${HOTEL}/admin/services?tab=menu`, { timeout: 30_000 })
})

test('корень платформы: пришедшему по старой ссылке объясняют адрес', async ({ page }) => {
  await page.goto(`${ROOT}/login`)
  await expect(page.getByTestId('wrong-host-notice')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('wrong-host-example')).toContainText('guest.localhost')

  // Гостевой deep-link из QR на корне тоже объясняет, а не молчит.
  await page.goto(`${ROOT}/r/305`)
  await expect(page.getByTestId('wrong-host-notice')).toBeVisible({ timeout: 30_000 })
})

test('корень платформы: консоль на месте', async ({ page }) => {
  await page.goto(`${ROOT}/admin`)
  await expect(page.getByTestId('admin-login-email')).toBeVisible({ timeout: 30_000 })
})

test('манифест PWA: на корне установку не предлагают, на адресе отеля — да', async ({ page }) => {
  await page.goto(`${ROOT}/`)
  await expect(page.getByTestId('landing')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0)

  await page.goto(`${HOTEL}/`)
  await expect(page.getByTestId('guest-room-input')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1)
})

/* ── Лендинг: устройство новой витрины ──────────────────────────────────── */

test('первый экран — фотография с текстом поверх, без карточек', async ({ page }) => {
  await page.goto(`${ROOT}/`)
  const hero = page.getByTestId('landing-hero')
  await expect(hero).toBeVisible({ timeout: 30_000 })

  // Карточек в первом экране нет намеренно: он продаёт кадром, а не списком.
  await expect(hero.locator('.MuiCard-root')).toHaveCount(0)
  // Одна кнопка, а не две: второе действие уводило внимание от единственного.
  await expect(hero.getByRole('link')).toHaveCount(1)
})

test('лендинг не делает ни одного запроса к API', async ({ page }) => {
  // Правило страницы, а не договорённость: она статична по устройству. Форма
  // заявки означала бы ручку на бэкенде и приём персональных данных.
  const calls: string[] = []
  page.on('request', (r) => {
    // Именно `/api/v1/`, а не `/api/`: в режиме разработки Vite отдаёт модули
    // по путям вида `/src/api/client.ts`, и широкий фильтр краснел на них —
    // то есть на загрузке собственного кода, а не на запросе к серверу.
    if (r.url().includes('/api/v1/')) calls.push(r.url())
  })
  await page.goto(`${ROOT}/`)
  await expect(page.getByTestId('landing-hero')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('landing-contact').scrollIntoViewIfNeeded()
  await page.waitForLoadState('networkidle')
  expect(calls, calls.join('\n')).toEqual([])
})

test('утверждения вместо цифр', async ({ page }) => {
  await page.goto(`${ROOT}/`)

  // Числа сняты целиком: счётчик модулей привязывал витрину к нашему реестру и
  // старел от первой же правки, а «4 языка» и «0 установок» обещали потолок,
  // которого план не предполагает.
  for (const claim of ['forms', 'chain', 'pay']) {
    await expect(page.getByTestId(`landing-claim-${claim}`)).toBeVisible({ timeout: 20_000 })
  }
  for (const gone of ['modules', 'offerings', 'workplaces', 'languages', 'installs']) {
    await expect(page.getByTestId(`landing-figure-${gone}`)).toHaveCount(0)
  }
})

test('переключатели: на обложке читаемы, при прокрутке — в полосе', async ({ page }) => {
  /*
    ПЕРЕКЛЮЧАТЕЛИ ЖИВУТ НА ОБЛОЖКЕ И ПЕРЕЕЗЖАЮТ В ПОЛОСУ. Их уже убирали с кадра
    целиком — потому что значок темы там пропадал: он рисуется цветом
    `action.active`, то есть тёмным на светлой теме, и на тёмном кадре его не
    было видно вовсе. Лечится это не удалением, а собственным фоном под ними и
    принудительно белым цветом, пока обложка видна.

    Элемент ОДИН на оба места: два комплекта означали бы два состояния одного и
    того же. Поэтому укус проверяет не «есть на обложке» и «есть в полосе», а
    что это одна и та же коробка, сменившая место.
  */
  await page.goto(`${ROOT}/`)
  const nav = page.getByTestId('landing-nav')
  const controls = page.getByTestId('landing-controls')
  await expect(nav).toHaveAttribute('data-shown', 'false', { timeout: 20_000 })

  await expect(controls).toHaveCount(1)
  await expect(controls).toHaveAttribute('data-place', 'hero')
  await expect(controls.getByTestId('theme-toggle')).toBeVisible()
  await expect(controls.getByTestId('guest-language')).toBeVisible()

  // Значок темы на кадре — белый, а не цветом темы: иначе он пропадёт.
  const ink = await controls
    .getByTestId('theme-toggle')
    .evaluate((node) => getComputedStyle(node).color)
  expect(ink, 'значок темы на фотографии взял цвет темы и пропадёт на тёмном кадре').toBe(
    'rgb(255, 255, 255)',
  )

  await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.9)))
  await expect(nav).toHaveAttribute('data-shown', 'true', { timeout: 20_000 })
  await expect(controls).toHaveAttribute('data-place', 'nav')
  await expect(controls).toHaveCount(1)
})

test('частиц на лендинге нет ни на одной секции', async ({ page }) => {
  /*
    Частицы сняты вместе с холстом: на светлой секции они читались как плесень.
    Укус на отсутствие, потому что вернуть их проще всего случайно — слот под
    них жил прямо в `Screen` и напрашивался к повторному использованию.
  */
  await page.goto(`${ROOT}/`)
  await expect(page.getByTestId('landing')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(500)
  await expect(page.getByTestId('landing').locator('canvas')).toHaveCount(0)
})

test('один продукт на трёх устройствах', async ({ page }) => {
  await page.goto(`${ROOT}/`)
  await page.getByTestId('landing-devices').scrollIntoViewIfNeeded()
  for (const kind of ['phone', 'tablet', 'desktop']) {
    await expect(page.getByTestId(`landing-device-${kind}`)).toBeVisible({ timeout: 20_000 })
  }
})

test('схемы движения данных сохранены', async ({ page }) => {
  // Их переносили в новую оправу — проверяем, что они доехали живыми.
  await page.goto(`${ROOT}/`)
  await page.getByTestId('landing-flows').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('flow-order')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('flow-room')).toBeVisible()
})

test('при просьбе не двигать движения нет', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${ROOT}/`)
  await expect(page.getByTestId('landing-hero')).toBeVisible({ timeout: 30_000 })

  // Параллакс снят: фон прокручивается вместе со страницей, а не «прибит».
  const attachment = await page
    .getByTestId('landing-hero')
    .locator('div[aria-hidden]')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundAttachment)
  expect(attachment).toBe('scroll')
})

/* ── Посадка НА ХОСТЕ ОТЕЛЯ ─────────────────────────────────────────────── */

test('повар на адресе отеля: вход на месте ведёт на доску, а не в панель', async ({ page }) => {
  /*
    УКУС РЕЖИМА, А НЕ ПРАВИЛА. Правило «решаем по правам» уже покрыто в режиме
    одного хоста, и там оно работало. На адресе отеля путь другой: панель и
    вход живут по одному адресу `/admin`, вход рисуется НА МЕСТЕ, и у маршрута
    есть индексный редирект. Он срабатывает при рендере — раньше, чем
    императивный `navigate()` со страницы входа, — и увозил повара в раздел,
    куда ему нельзя.

    Дважды это прошло мимо проверок и уехало на стенд. Поэтому укус написан
    именно здесь, на хосте отеля.
  */
  await page.goto(`${HOTEL}/admin`)
  await page.getByTestId('login-email').fill('chef@crystal.local')
  await page.getByTestId('login-password').fill('chef12345')
  await page.getByTestId('login-submit').click()

  await expect(page).toHaveURL(/\/tracker/, { timeout: 30_000 })
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 30_000 })
  // По дороге не мелькнул отказ: «дошёл через отказ» — это то же состояние.
  await expect(page.getByTestId('cms-no-access')).toBeHidden()
})

test('закладка на /admin отеля ведёт повара на доску', async ({ page }) => {
  // Тот же индексный редирект — второй его вход: прямая закладка на корень
  // панели у уже вошедшего человека.
  await page.goto(`${HOTEL}/admin`)
  await page.getByTestId('login-email').fill('chef@crystal.local')
  await page.getByTestId('login-password').fill('chef12345')
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/tracker/, { timeout: 30_000 })

  await page.goto(`${HOTEL}/admin`)
  await expect(page).toHaveURL(/\/tracker/, { timeout: 20_000 })
})

test('администратор на адресе отеля по-прежнему попадает в панель', async ({ page }) => {
  // Правило решает по праву: у кого доступ есть — посадка не меняется.
  await page.goto(`${HOTEL}/admin`)
  await page.getByTestId('login-email').fill('owner@crystal.local')
  await page.getByTestId('login-password').fill('chef12345')
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 30_000 })
})

test('план номера: играет сам, а после касания — в руках посетителя', async ({ page }) => {
  /*
    УКУС ПРО ПЕРЕДАЧУ УПРАВЛЕНИЯ. Автопоказ нужен затем, что пролиставший мимо
    ничего не нажмёт и не узнает, что план живой. Но экран, который
    перехватывает управление обратно после касания, воспринимается как
    сломанный — поэтому остановка НАВСЕГДА, и это проверяется, а не
    подразумевается.

    Состояние читается с плиты (`data-light`, `data-curtains`), а не с подписей:
    подпись — это оформление, и она менялась дважды, пока укус стоял.
  */
  await page.goto(`${ROOT}/`)
  const plan = page.getByTestId('landing-room-plan')
  await plan.scrollIntoViewIfNeeded()
  await expect(plan).toHaveAttribute('data-taken', 'false', { timeout: 20_000 })

  const plate = plan.locator('[data-light]')
  const state = async () =>
    `${await plate.getAttribute('data-light')}/${await plate.getAttribute('data-curtains')}`

  const before = await state()
  await expect
    .poll(state, { timeout: 8_000, message: 'план не сыграл сам — пролиставший мимо не увидит, что он живой' })
    .not.toBe(before)

  await page.getByTestId('room-plan-light').click()
  await expect(plan).toHaveAttribute('data-taken', 'true')

  const taken = await state()
  await page.waitForTimeout(3000)
  expect(await state(), 'план продолжил играть сам после касания').toBe(taken)
})

test('план номера: кадр номера, а не схема', async ({ page }) => {
  /*
    Два совмещённых кадра — суть приёма: свет показан настоящим светом с
    рендера. Подмени их рисованной схемой — витрина снова будет рассказывать про
    продукт вместо того, чтобы его показывать.
  */
  await page.goto(`${ROOT}/`)
  const plan = page.getByTestId('landing-room-plan')
  await plan.scrollIntoViewIfNeeded()
  await expect(plan.getByTestId('room-plan-base')).toBeVisible({ timeout: 20_000 })

  /*
    Ждём именно ЗАГРУЗКУ, а не появление узла: `toBeVisible` проходит, пока
    картинка ещё едет по сети, и в полном наборе — где перед этим отработали
    десятки тестов и сеть занята — замер приходился на нулевую ширину. Экран при
    этом был исправен; падал замер.
  */
  await expect
    .poll(
      () =>
        plan
          .getByTestId('room-plan-base')
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      { timeout: 20_000, message: 'ночной кадр не загрузился' },
    )
    .toBeGreaterThan(0)
  await expect(plan.getByTestId('room-plan-lit-bedroom')).toHaveCount(1)
})

test('план при просьбе не двигать: статичен и со включённым светом', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${ROOT}/`)
  const plan = page.getByTestId('landing-room-plan')
  await plan.scrollIntoViewIfNeeded()

  // Управление сразу у посетителя: автопоказа нет вовсе, а не «остановлен».
  await expect(plan).toHaveAttribute('data-taken', 'true', { timeout: 20_000 })
  const plate = plan.locator('[data-light]')
  await expect(plate).toHaveAttribute('data-light', 'true')
  const first = await plate.getAttribute('data-curtains')
  await page.waitForTimeout(2600)
  expect(await plate.getAttribute('data-curtains')).toBe(first)
  await expect(plate).toHaveAttribute('data-light', 'true')
})

test('меню равно составу страницы: ни лишних пунктов, ни забытых разделов', async ({ page }) => {
  /*
    УКУС В ОБЕ СТОРОНЫ, и это важнее, чем кажется. Меню расходилось со страницей
    дважды: сперва три ссылки на девять разделов, потом четыре сводных пункта.
    Проверка «каждая ссылка куда-то ведёт» ловит только вторую половину беды —
    пункт в никуда. Забытый раздел она пропускает, а именно он и был.

    Поэтому состав меню сверяется с составом страницы ПО ФАКТУ: разделом
    считается секция с заголовком. Секция без заголовка (три утверждения под
    обложкой) в меню не нужна — надписи для неё на странице не существует.
  */
  await page.goto(`${ROOT}/`)
  await expect(page.getByTestId('landing')).toBeVisible({ timeout: 30_000 })

  const sections = await page.evaluate(() =>
    Array.from(document.querySelectorAll('section[id]'))
      .filter((node) => node.querySelector('h2'))
      .map((node) => node.id),
  )
  const links = await page.locator('[data-testid^="landing-nav-"][href^="#"]').evaluateAll((nodes) =>
    nodes.map((node) => (node.getAttribute('href') ?? '').slice(1)),
  )

  for (const id of sections) {
    expect(links, `раздел #${id} есть на странице, но его нет в меню`).toContain(id)
  }
  for (const id of links) {
    await expect(page.locator(`#${id}`), `пункт меню #${id} ведёт в никуда`).toHaveCount(1)
  }
})

test('переход по пункту: раздел встаёт ниже полосы, пункт подсвечивается', async ({ page }) => {
  /*
    Липкая полоса перекрывает верх страницы, и переход по якорю без поправки
    ставит заголовок раздела ровно под неё — человек приезжает к тексту без
    начала. Поправка и подсветка считают от одной и той же величины: разойдись
    они, нажатие вело бы в один раздел, а подсвечивало соседний (так и было).
  */
  await page.goto(`${ROOT}/`)
  await expect(page.getByTestId('landing')).toBeVisible({ timeout: 30_000 })
  // Полоса появляется только после обложки — до этого она не принимает нажатий.
  await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 1.2)))
  await expect(page.getByTestId('landing-nav')).toHaveAttribute('data-shown', 'true', {
    timeout: 20_000,
  })

  for (const key of ['devices', 'how', 'modules']) {
    await page.getByTestId(`landing-nav-${key}`).click()
    await page.waitForTimeout(900)

    const gap = await page.evaluate(
      (id) => document.getElementById(id)!.getBoundingClientRect().top,
      key,
    )
    const navBottom = await page
      .getByTestId('landing-nav')
      .evaluate((node) => node.getBoundingClientRect().bottom)
    expect(gap, `раздел ${key} уехал под полосу`).toBeGreaterThanOrEqual(navBottom - 1)
    // …и не «где-то ниже»: приехали к началу раздела, а не к его середине.
    expect(gap, `раздел ${key} встал слишком низко`).toBeLessThan(navBottom + 40)

    await expect(page.getByTestId(`landing-nav-${key}`)).toHaveAttribute('data-current', 'true')
    await expect(page.getByTestId('landing-nav')).toHaveAttribute('data-active', key)
  }
})

test('переход едет, а при просьбе не двигать — мгновенный', async ({ page }) => {
  await page.goto(`${ROOT}/`)
  await expect(page.getByTestId('landing')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 1.2)))
  await expect(page.getByTestId('landing-nav')).toHaveAttribute('data-shown', 'true', {
    timeout: 20_000,
  })

  // Едет: через треть анимации страница уже не там, где была, но ещё не на месте.
  const before = await page.evaluate(() => window.scrollY)
  await page.getByTestId('landing-nav-contact').click()
  await page.waitForTimeout(160)
  const middle = await page.evaluate(() => window.scrollY)
  await page.waitForTimeout(1200)
  const after = await page.evaluate(() => window.scrollY)
  expect(middle, 'переход не сдвинулся с места').toBeGreaterThan(before)
  expect(middle, 'переход оказался прыжком, а не скольжением').toBeLessThan(after - 50)

  // При просьбе не двигать анимации нет вовсе — ни одного промежуточного кадра.
  const calm = await page.context().newPage()
  await calm.emulateMedia({ reducedMotion: 'reduce' })
  await calm.goto(`${ROOT}/`)
  await expect(calm.getByTestId('landing')).toBeVisible({ timeout: 30_000 })
  await calm.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 1.2)))
  await expect(calm.getByTestId('landing-nav')).toHaveAttribute('data-shown', 'true', {
    timeout: 20_000,
  })
  // Раздел из середины страницы, а не последний: у последнего цель ниже дна
  // прокрутки, страница упирается в него, и замер мерил бы упор, а не переход.
  const target = await calm.evaluate(
    () => document.getElementById('how')!.getBoundingClientRect().top + window.scrollY,
  )
  await calm.getByTestId('landing-nav-how').click()
  await calm.waitForTimeout(40)
  const landed = await calm.evaluate(() => window.scrollY)
  expect(Math.abs(landed - (target - 64)), 'при просьбе не двигать переход всё-таки анимируется')
    .toBeLessThan(24)
  await calm.close()
})

test('значки языка и темы стоят по средней линии полосы', async ({ page }) => {
  /*
    Коробка со значками выше строки полосы, и совместить их отступом сверху
    можно только случайно — так они и сидели выше середины. Укус меряет центры,
    а не пиксели отступа: подгонка отступа при смене высоты полосы разъедется
    снова, совпадение центров — нет.
  */
  await page.goto(`${ROOT}/`)
  await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 1.2)))
  const nav = page.getByTestId('landing-nav')
  await expect(nav).toHaveAttribute('data-shown', 'true', { timeout: 20_000 })
  // Полоса выезжает сдвигом: замер на полпути сравнивал бы значки с ещё не
  // приехавшей полосой и врал бы на её высоту.
  await page.waitForTimeout(600)

  const navBox = (await nav.boundingBox())!
  for (const testId of ['guest-language', 'theme-toggle']) {
    const box = (await page.getByTestId('landing-controls').getByTestId(testId).boundingBox())!
    const drift = Math.abs(box.y + box.height / 2 - (navBox.y + navBox.height / 2))
    expect(drift, `${testId} стоит не по средней линии полосы`).toBeLessThanOrEqual(2)
  }
})

test('корпус телефона: содержимое не заезжает под вырез', async ({ page }) => {
  /*
    Снимок лежал во весь экран, и вырез накрывал его верхнюю строку: от «Номер
    305» оставалось «305». На аппарате приложение начинается НИЖЕ выреза, и
    здесь так же — безопасная зона сверху.
  */
  await page.goto(`${ROOT}/`)
  const phone = page.getByTestId('landing-phone-guest')
  await phone.scrollIntoViewIfNeeded()
  await expect(phone).toBeVisible({ timeout: 20_000 })

  const shot = phone.locator('img')
  const notch = phone.locator('[aria-hidden]').last()
  const shotBox = (await shot.boundingBox())!
  const notchBox = (await notch.boundingBox())!
  expect(shotBox.y, 'снимок начинается выше нижнего края выреза').toBeGreaterThanOrEqual(
    notchBox.y + notchBox.height,
  )
})

test.describe('лендинг пальцем, без мыши', () => {
  /*
    НА СЕНСОРНОМ ЭКРАНЕ НАВЕДЕНИЯ НЕТ. Раскрытие по `:hover` там либо не
    открывается вовсе, либо залипает на последнем нажатом элементе до следующего
    касания — и то и другое читается поломкой. В полосе такое раскрытие стояло
    (четыре сводных пункта с выпадающими списками) и ушло вместе с переходом на
    плоский список; укус держит это свойство, а не надеется на память.

    `hasTouch` без `isMobile`: нужна именно среда без наведения, а не эмуляция
    конкретного аппарата — от неё зависит только вёрстка, а проверяется здесь
    поведение.
  */
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('меню открывается и работает касанием', async ({ page }) => {
    await page.goto(`${ROOT}/`)
    await expect(page.getByTestId('landing')).toBeVisible({ timeout: 30_000 })
    await page.evaluate(() => window.scrollTo(0, Math.round(window.innerHeight * 1.4)))
    await expect(page.getByTestId('landing-nav')).toHaveAttribute('data-shown', 'true', {
      timeout: 20_000,
    })

    // Среда действительно без наведения — иначе укус проверял бы мышь.
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false)
    // Ни одного списка, который открывается только наведением.
    await expect(page.locator('[data-testid$="-sub"]')).toHaveCount(0)

    // Дальний пункт: ряд едет вбок, и до него можно доехать пальцем.
    const row = page.getByTestId('landing-nav-links')
    expect(await row.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
    await row.evaluate((node) => node.scrollTo({ left: 9999 }))
    await page.getByTestId('landing-nav-contact').tap()
    await expect(page.getByTestId('landing-nav')).toHaveAttribute('data-active', 'contact')

    // Переключатель языка — тоже касанием, а не наведением.
    await page.getByTestId('guest-language').tap()
    await page.getByTestId('guest-language-en').tap()
    await expect(page.getByTestId('landing-nav-contact')).toHaveText('Getting started')
  })

  test('план номера отдаётся касанию', async ({ page }) => {
    await page.goto(`${ROOT}/`)
    const plan = page.getByTestId('landing-room-plan')
    await plan.scrollIntoViewIfNeeded()
    await expect(plan).toBeVisible({ timeout: 20_000 })

    await page.getByTestId('room-plan-curtains').tap()
    await expect(plan).toHaveAttribute('data-taken', 'true')
    await expect(plan.locator('[data-curtains]')).toHaveAttribute('data-curtains', 'open')
  })
})

test('картинки блока стоят на одной линии', async ({ page }) => {
  /*
    Блок был одним рядом из двух колонок, центрованных по отдельности, и верхние
    края картинок расходились на половину разницы их высот: 29, 90 и 48 пикселей
    в трёх блоках. Отступом это не лечится — разница зависит от длины заголовка,
    а он переводится на четыре языка, — поэтому линию держит сетка, и укус
    проверяет именно её результат.

    Замер по КОРНЮ снимка, а не по картинке внутри него: у телефона содержимое
    начинается ниже выреза, и сравнение с ним показывало бы безопасную зону, а
    не выравнивание.
  */
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${ROOT}/`)
  await expect(page.getByTestId('landing')).toBeVisible({ timeout: 30_000 })

  for (const id of ['landing-guest', 'landing-staff', 'landing-room']) {
    const section = page.getByTestId(id)
    await section.scrollIntoViewIfNeeded()
    const shot = (await section.getByTestId(`${id}-block-shot`).boundingBox())!
    const photo = (await section.getByTestId(`${id}-block-photo`).boundingBox())!
    expect(Math.abs(shot.y - photo.y), `${id}: верхние края картинок разошлись`).toBeLessThanOrEqual(1)
    expect(
      Math.abs(shot.y + shot.height - (photo.y + photo.height)),
      `${id}: нижние края картинок разошлись`,
    ).toBeLessThanOrEqual(1)
  }

  const devices = page.getByTestId('landing-devices')
  await devices.scrollIntoViewIfNeeded()
  const tops: number[] = []
  for (const kind of ['phone', 'tablet', 'desktop']) {
    tops.push((await devices.getByTestId(`landing-device-${kind}`).boundingBox())!.y)
  }
  expect(Math.max(...tops) - Math.min(...tops), 'устройства висят на разной высоте').toBeLessThanOrEqual(1)

  // Подписи — на своей общей линии: у кадров разная высота, и без прижатия к
  // низу ячейки они разъезжались бы вслед за ней.
  const captions = await devices.evaluate((root) =>
    Array.from(root.querySelectorAll('.MuiTypography-subtitle2')).map(
      (node) => node.getBoundingClientRect().top,
    ),
  )
  expect(Math.max(...captions) - Math.min(...captions), 'подписи устройств разъехались').toBeLessThanOrEqual(1)
})

test('на узком экране выравнивание не оставляет дыр', async ({ page }) => {
  /*
    Сетка с явными рядами — обычный способ получить дыру там, где колонок больше
    нет: пустая ячейка второй колонки превращается в пустой ряд. На узком экране
    рядов не назначается вовсе, и картинки идут потоком с одинаковым зазором.
    Укус меряет ЗАЗОРЫ, а не расположение: дыра — это именно неровный зазор.
  */
  await page.setViewportSize({ width: 420, height: 820 })
  await page.goto(`${ROOT}/`)
  await expect(page.getByTestId('landing')).toBeVisible({ timeout: 30_000 })

  const gaps: number[] = []
  for (const id of ['landing-guest', 'landing-staff', 'landing-room']) {
    const section = page.getByTestId(id)
    await section.scrollIntoViewIfNeeded()
    const shot = (await section.getByTestId(`${id}-block-shot`).boundingBox())!
    const photo = (await section.getByTestId(`${id}-block-photo`).boundingBox())!
    const gap = photo.y - (shot.y + shot.height)
    expect(gap, `${id}: фотография наехала на снимок`).toBeGreaterThan(0)
    gaps.push(gap)
  }
  // Один и тот же зазор во всех блоках: разъехались бы — значит где-то ряд
  // остался пустым.
  expect(Math.max(...gaps) - Math.min(...gaps), 'зазоры между картинками разные').toBeLessThanOrEqual(4)
})
