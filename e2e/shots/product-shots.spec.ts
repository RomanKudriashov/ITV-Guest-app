import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { ADMIN, CREDENTIALS, DEMO_ROOM } from '../tests/helpers'

/**
 * СЪЁМКА СНИМКОВ ДЛЯ ЛЕНДИНГА — прогоном, а не рисунками.
 *
 * Нарисованный экран продукта врёт через месяц и никто этого не замечает:
 * сверять макет с приложением некому. Снятый снимается заново одной командой,
 * и если экран изменился — на лендинге это видно сразу.
 *
 * Живёт ОТДЕЛЬНО от набора проверок (`e2e/tests`) намеренно: это не проверка,
 * а инструмент. В обычном прогоне он не участвует — иначе каждый прогон писал
 * бы файлы в репозиторий.
 *
 *     docker compose up -d           # стенд должен быть поднят и посеян
 *     cd e2e && npx playwright test --config=shots/config.ts
 *
 * Снимки кладутся в `frontend/public/landing/` — статикой, а не в бандл: их
 * отдаёт nginx, и вес страницы от них не растёт.
 *
 * JPEG, а не PNG: скриншот витрины в PNG весит под мегабайт, и четыре таких на
 * странице, которую открывают с телефона, — это плохой первый экран.
 */

const OUT = path.resolve(__dirname, '../../frontend/public/landing')

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true })
})

async function shoot(page: Page, name: string): Promise<void> {
  // Даём догрузиться шрифтам и картинкам: снимок с подставным шрифтом или
  // серым прямоугольником вместо фото — худшая реклама, чем его отсутствие.
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82 })
}

async function loginCms(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(ADMIN.email)
  await page.getByTestId('login-password').fill(ADMIN.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 })
}

/*
  ГОСТЕВЫЕ СНИМКИ — ТЕЛЕФОНОМ. Гость держит витрину в руке, и десктопный кадр,
  вставленный в рамку телефона, обрезается по краям: на лендинге это видно как
  срезанное слово в заголовке. Размер кадра должен совпадать с устройством, о
  котором он рассказывает.
*/
test.use({ viewport: { width: 390, height: 844 } })

test('витрина гостя', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-nav-home')).toBeVisible({ timeout: 30_000 })
  await shoot(page, 'guest')
})

test('экран номера', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-nav-room')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('guest-nav-room').click()
  await expect(page.getByTestId('room-page')).toBeVisible({ timeout: 30_000 })
  await shoot(page, 'room')
})

test('доска исполнителя', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(CREDENTIALS.email)
  await page.getByTestId('login-password').fill(CREDENTIALS.password)
  await page.getByTestId('login-submit').click()
  // Ждём ухода со входа: без этого переход на доску случается раньше, чем
  // сессия записана, и доска встречает нас формой входа.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 })
  await page.goto('/tracker')
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 30_000 })
  await shoot(page, 'tracker')
})

test('панель отеля', async ({ page }) => {
  await loginCms(page)
  await page.goto('/cms/dashboard')
  await expect(page.getByTestId('cms-dashboard')).toBeVisible({ timeout: 30_000 })
  await shoot(page, 'cms')
})

/*
  ОДИН ПРОДУКТ НА ТРЁХ УСТРОЙСТВАХ — каждый кадр в СВОЁМ вьюпорте.

  Растянуть телефонный снимок до планшета значило бы показать не то, что видит
  человек: витрина перестраивается по ширине, и на планшете у неё другая сетка.
  Кадр обязан быть снят тем размером, о котором рассказывает.
*/
test.describe('витрина на трёх устройствах', () => {
  for (const [name, viewport] of [
    ['device-phone', { width: 390, height: 844 }],
    ['device-tablet', { width: 834, height: 1112 }],
    ['device-desktop', { width: 1440, height: 900 }],
  ] as const) {
    test(name, async ({ browser }) => {
      const context = await browser.newContext({ viewport })
      const page = await context.newPage()
      await page.goto('/')
      await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
      await page.getByTestId('guest-room-submit').click()
      await expect(page.getByTestId('guest-nav-home')).toBeVisible({ timeout: 30_000 })
      await shoot(page, name)
      await context.close()
    })
  }
})
