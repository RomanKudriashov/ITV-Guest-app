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
