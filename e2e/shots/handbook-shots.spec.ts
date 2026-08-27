import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { ADMIN, CREDENTIALS, PLATFORM } from '../tests/helpers'

/**
 * СНИМКИ ДЛЯ ДВУХ ЭКРАННЫХ КНИГ — прогоном, а не подкладыванием руками.
 *
 * Книга консоли и книга панели отеля состоят из ссылок на экраны. Экран,
 * вставленный картинкой один раз, врёт через месяц и никто этого не замечает:
 * сверять снимок с приложением некому. Здесь он пересоздаётся одной командой,
 * и расхождение видно сразу — на снимке.
 *
 *     docker compose up -d                                    # стенд посеян
 *     cd e2e && npx playwright test --config=shots/config.ts handbook-shots
 *
 * Снимки кладутся В КАТАЛОГ КНИГИ (`docs/handbook-…/shots/`), а не в
 * `frontend/public`: это части документа, а не статика приложения. Лендинг
 * снимается своим прогоном (`product-shots.spec.ts`) и в этот файл не лезет —
 * у него другой получатель и другой формат.
 *
 * PNG, а не JPEG: здесь снимают ИНТЕРФЕЙС, то есть в основном мелкий текст, и
 * артефакты JPEG на нём читаются как дефекты вёрстки. Масштаб — 1: удвоенный
 * даёт файлы по паре мегабайт, а книгу читают в просмотрщике репозитория.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ. Прогон ничего не создаёт и не удаляет: стенд
 * общий, и съёмка, оставляющая за собой отели и заказы, назавтра портит и
 * показ, и чужие проверки. Все экраны снимаются на том, что уже посеяно.
 */

const PLATFORM_OUT = path.resolve(__dirname, '../../docs/handbook-platform/shots')
const HOTEL_OUT = path.resolve(__dirname, '../../docs/handbook-hotel/shots')

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  mkdirSync(PLATFORM_OUT, { recursive: true })
  mkdirSync(HOTEL_OUT, { recursive: true })
})

async function shoot(page: Page, dir: string, name: string): Promise<void> {
  // Шрифты и картинки — иначе на снимке подставной шрифт и серые прямоугольники
  // вместо фотографий, то есть книга показывает то, чего пользователь не видит.
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(dir, `${name}.png`), type: 'png' })
}

async function loginConsole(page: Page): Promise<void> {
  await page.goto('/admin')
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 30_000 })
}

async function section(page: Page, key: string): Promise<void> {
  await page.getByTestId(`admin-nav-${key}`).click()
  await page.waitForLoadState('networkidle')
}

async function loginPanel(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(ADMIN.email)
  await page.getByTestId('login-password').fill(ADMIN.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 })
}

// --- Книга консоли платформы -------------------------------------------------

test('консоль: сводка', async ({ page }) => {
  await loginConsole(page)
  await expect(page.getByTestId('admin-overview')).toBeVisible({ timeout: 30_000 })
  await shoot(page, PLATFORM_OUT, 'overview')
})

test('консоль: флот', async ({ page }) => {
  await loginConsole(page)
  await section(page, 'fleet')
  await expect(page.getByTestId('admin-fleet')).toBeVisible({ timeout: 30_000 })
  await shoot(page, PLATFORM_OUT, 'fleet')
})

test('консоль: карточка отеля', async ({ page }) => {
  await loginConsole(page)
  await section(page, 'fleet')
  await expect(page.getByTestId('admin-fleet')).toBeVisible({ timeout: 30_000 })
  // Демо-отель по имени, а не «первая кнопка списка»: первая кнопка — это
  // фильтр над таблицей, и снимок молча выходил копией флота под именем
  // карточки. Поймано сверкой контрольных сумм: два разных экрана книги
  // оказались одним файлом.
  await page.getByTestId('admin-fleet-row-crystal').getByRole('button').first().click()
  await expect(page.getByTestId('admin-crumb-fleet')).toBeVisible({ timeout: 30_000 })
  await page.waitForLoadState('networkidle')
  await shoot(page, PLATFORM_OUT, 'hotel-card')
})

for (const key of ['groups', 'publications', 'modules', 'nodes', 'templates', 'team', 'support', 'security', 'audit']) {
  test(`консоль: ${key}`, async ({ page }) => {
    await loginConsole(page)
    await section(page, key)
    await shoot(page, PLATFORM_OUT, key)
  })
}

// --- Книга панели отеля ------------------------------------------------------

const PANEL: [name: string, url: string, marker?: string][] = [
  ['dashboard', '/cms/dashboard', 'cms-dashboard'],
  ['services', '/cms/services'],
  ['rooms', '/cms/rooms'],
  ['staff', '/cms/staff'],
  ['brand', '/cms/brand'],
  ['analytics', '/cms/analytics'],
  ['dictionaries', '/cms/dictionaries'],
  ['marketing', '/cms/marketing'],
  ['room-control', '/cms/room-control'],
  ['settings', '/cms/settings'],
  ['notifications', '/cms/notifications'],
]

for (const [name, url, marker] of PANEL) {
  test(`панель: ${name}`, async ({ page }) => {
    await loginPanel(page)
    await page.goto(url)
    if (marker) await expect(page.getByTestId(marker)).toBeVisible({ timeout: 30_000 })
    await shoot(page, HOTEL_OUT, name)
  })
}

test('панель: доска исполнителя', async ({ page }) => {
  // ИСПОЛНИТЕЛЕМ, а не администратором: доска собирается по точкам исполнения
  // сотрудника, и у администратора отеля их нет — экран пустой.
  await page.goto('/login')
  await page.getByTestId('login-email').fill(CREDENTIALS.email)
  await page.getByTestId('login-password').fill(CREDENTIALS.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 })
  await page.goto('/tracker')
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 30_000 })
  await shoot(page, HOTEL_OUT, 'tracker')
})
