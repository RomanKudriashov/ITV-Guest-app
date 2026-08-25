import { expect, test, type Page } from '@playwright/test'

/**
 * ПРОВЕРКА ВЫКАЧЕННОГО СТЕНДА ИСПОЛНЕНИЕМ — разово, не в наборе.
 *
 * Ходит по тем же экранам, что и человек, и на боевом стенде: смысл именно в
 * том, что проверяется выкаченная сборка, а не локальная.
 */

const STAND = 'https://app.147.45.245.172.sslip.io'
const HOTEL_HOST = 'https://crystal.app.147.45.245.172.sslip.io'
const PLATFORM = { email: 'owner@itv.local', password: 'oedykG4u0wNYKlwzTY' }
const HOTEL_ADMIN = { email: 'owner@crystal.local', password: 'chef12345' }
const VENUE_MANAGER = { email: 'manager.restaurant@crystal.local', password: 'chef12345' }
/** Доступ к доске даёт привязка к точке, а не роль отеля. */
const CHEF = { email: 'chef@crystal.local', password: 'chef12345' }
const HOTEL_ID = '1a14413a-3104-4994-83d4-6db0a726baea'
const DEMO_ROOM = '305'

async function loginConsole(page: Page): Promise<void> {
  await page.goto(`${STAND}/admin`)
  await page.evaluate(() => window.localStorage.clear())
  await page.goto(`${STAND}/admin`)
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 40_000 })
}

async function loginCms(page: Page, who = HOTEL_ADMIN): Promise<void> {
  await page.goto(`${HOTEL_HOST}/login`)
  await page.evaluate(() => window.localStorage.clear())
  await page.goto(`${HOTEL_HOST}/login`)
  await page.getByTestId('login-email').fill(who.email)
  await page.getByTestId('login-password').fill(who.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 40_000 })
}

test('консоль: управление номером — все вкладки, план со сценой', async ({ page }) => {
  await loginConsole(page)
  await page.goto(`${STAND}/admin?section=fleet&hotel=${HOTEL_ID}&tab=roomControl`)
  await expect(page.getByTestId('admin-hotel-room-control')).toBeVisible({ timeout: 30_000 })

  for (const tab of ['import', 'builder', 'plan', 'versions', 'diagnostics']) {
    await expect(page.getByTestId(`admin-grms-tab-${tab}`)).toBeVisible()
  }

  await page.getByTestId('admin-grms-tab-plan').click()
  await expect(page.getByTestId('grms-plan-editor')).toBeVisible({ timeout: 30_000 })
  // Сцена — то самое, что приезжало пустым: кадр собирался вне тенант-контекста.
  await expect(page.getByTestId('grms-plan-stage')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('grms-plan-no-frame')).toHaveCount(0)

  await page.getByTestId('admin-grms-tab-versions').click()
  await expect(page.getByTestId('grms-versions')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('admin-grms-tab-builder').click()
  await expect(page.getByTestId('grms-builder')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('admin-grms-tab-import').click()
  await expect(page.getByTestId('grms-import')).toBeVisible({ timeout: 30_000 })
})

test('консоль: диагностика инженера показывает разбор обмена', async ({ page }) => {
  await loginConsole(page)
  await page.goto(`${STAND}/admin?section=fleet&hotel=${HOTEL_ID}&tab=roomControl`)
  await expect(page.getByTestId('admin-hotel-room-control')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('admin-grms-tab-diagnostics').click()
  await expect(page.getByTestId('grms-diagnostics')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('diagnostics-depth-hotel')).toHaveCount(0)
  await expect(page.getByTestId('diagnostics-table')).toBeVisible({ timeout: 30_000 })
  const firstRow = page.getByTestId('diagnostics-table').locator('tbody tr').first()
  await firstRow.getByRole('button').first().click()
  await expect(page.getByTestId('diagnostics-raw').first()).toBeVisible({ timeout: 20_000 })
})

test('CMS отеля: четырёх вкладок нет, старый адрес объясняет переезд', async ({ page }) => {
  await loginCms(page)
  await page.goto(`${HOTEL_HOST}/cms/room-control`)
  await expect(page.getByTestId('grms-tab-access')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('grms-tab-check')).toBeVisible()
  await expect(page.getByTestId('grms-tab-diagnostics')).toBeVisible()
  for (const gone of ['import', 'builder', 'plan', 'versions']) {
    await expect(page.getByTestId(`grms-tab-${gone}`)).toHaveCount(0)
  }
  await expect(page.getByTestId('grms-config-moved')).toBeVisible()

  // Старый адрес вкладки ведёт не в никуда, а в то же объяснение.
  await page.goto(`${HOTEL_HOST}/cms/room-control?tab=plan`)
  await expect(page.getByTestId('grms-config-moved')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('grms-tab-diagnostics').click()
  await expect(page.getByTestId('diagnostics-depth-hotel')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('grms-tab-access').click()
  await expect(page.getByTestId('grms-access')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('grms-demo-warning')).toBeVisible()
})

test('гость: экран номера управляет как раньше', async ({ page }) => {
  await page.goto(`${HOTEL_HOST}/`)
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.goto(`${HOTEL_HOST}/`)
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-nav-room')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('guest-nav-room').click()
  await expect(page.getByTestId('room-page')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-testid^="room-control-"]').first()).toBeVisible({
    timeout: 30_000,
  })
})

test('дашборд: под администратором отеля и под управляющим заведением', async ({ page }) => {
  await loginCms(page)
  await page.goto(`${HOTEL_HOST}/cms/dashboard`)
  await expect(page.getByTestId('cms-dashboard')).toBeVisible({ timeout: 40_000 })

  await loginCms(page, VENUE_MANAGER)
  await page.goto(`${HOTEL_HOST}/cms/dashboard`)
  await expect(page.getByTestId('cms-dashboard')).toBeVisible({ timeout: 40_000 })
})

test('доска: сводка смены, фильтры и перетаскивание', async ({ page }) => {
  await loginCms(page, CHEF)
  await page.goto(`${HOTEL_HOST}/tracker`)
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 40_000 })
  await expect(page.getByTestId('tracker-shift')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('tracker-filters-toggle').click()
  await expect(page.getByTestId('tracker-filters-panel')).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('Escape')

  // Перетаскивание — НАСТОЯЩЕЕ, за ручку, и только вперёд: доска forward-only,
  // и отменить бросок нельзя. Берём первую карточку в «новых»; если новых нет,
  // тест обязан упасть, а не тихо пропустить проверку — пустая доска на стенде
  // означает, что проверять перетаскивание было не на чем.
  const grip = page
    .getByTestId('tracker-column-new')
    .locator('[data-testid^="tracker-grip-"]')
    .first()
  await expect(grip, 'на доске нет ни одной карточки — перетаскивать нечего').toBeVisible({
    timeout: 20_000,
  })
  const number = ((await grip.getAttribute('data-testid')) ?? '').replace('tracker-grip-', '')
  // Цель — СЛЕДУЮЩИЙ шаг, а не любой: доска пускает вперёд по одному, и бросок
  // через голову она справедливо игнорирует (запрещённые цели видны при захвате).
  const target = page.getByTestId('tracker-column-accepted')
  await grip.hover()
  await page.mouse.down()
  const box = (await target.boundingBox()) as { x: number; y: number; width: number; height: number }
  await page.mouse.move(box.x + box.width / 2, box.y + 30, { steps: 6 })
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()

  // Карточка доехала до «готовится» — и это проверяется в колонке, а не по
  // исчезновению со старого места: исчезнуть она могла бы и по чужому действию.
  await expect(
    page.getByTestId('tracker-column-accepted').getByTestId(`tracker-order-${number}`),
  ).toBeVisible({ timeout: 30_000 })
})
