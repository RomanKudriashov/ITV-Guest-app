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

test('липкое меню: скрыто на обложке, появляется после неё', async ({ page }) => {
  /*
    Переключатели языка и темы уехали С ФОТОГРАФИИ в липкое меню: на кадре они
    терялись — белая иконка попадала то на светлую штору, то на тёмное дерево.
    Обложка осталась чистой фотографией.
  */
  await page.goto(`${ROOT}/`)
  const nav = page.getByTestId('landing-nav')
  await expect(nav).toHaveAttribute('data-shown', 'false', { timeout: 20_000 })

  // Частиц на обложке нет: кадр здесь главный, и спорить с ним нечему.
  await expect(page.getByTestId('landing-hero').locator('canvas')).toHaveCount(0)
  // Зато есть подсказка, что ниже что-то есть.
  await expect(page.getByTestId('landing-scroll-hint')).toBeVisible()

  await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.9)))
  await expect(nav).toHaveAttribute('data-shown', 'true', { timeout: 20_000 })
  // Оба переключателя — внутри меню, а не поверх кадра.
  await expect(nav.locator('svg')).toHaveCount(2)
})

test('частицы живут на секциях под обложкой', async ({ page }) => {
  await page.goto(`${ROOT}/`)
  await page.getByTestId('landing-flows').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('landing-flows').locator('canvas')).toHaveCount(1)
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
