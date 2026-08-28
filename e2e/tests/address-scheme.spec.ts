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

test('цифры — только те, что у нас есть', async ({ page }) => {
  await page.goto(`${ROOT}/`)
  // Языки и модули считаются из перечислений системы, а не вписаны словами.
  await expect(page.getByTestId('landing-figure-languages')).toHaveText('4')
  await expect(page.getByTestId('landing-figure-modules')).toHaveText('9')
  await expect(page.getByTestId('landing-figure-installs')).toHaveText('0')
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
