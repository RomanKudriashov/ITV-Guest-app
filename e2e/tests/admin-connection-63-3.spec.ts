import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, PLATFORM } from './helpers'

/**
 * ПОДКЛЮЧЕНИЕ УПРАВЛЕНИЯ НОМЕРОМ (партия 63-3). Серверная половина —
 * `backend/tests/grms/test_control_server_63_3.py`, коннектор —
 * `backend/tests/grms/services/test_connector_remote_63_3.py`.
 *
 * Мастер «до готово» — на Кристалле: у него единственный живой коннектор
 * (эмулятор iRidi за ним). Проверка сама меняет стенд, поэтому условие
 * задаётся явно и возвращается: в начале и в конце сервер в Control убран —
 * Кристалл снова работает по адресу из файла коннектора.
 *
 * Новый коннектор, ключ и команда установки — на своём отеле прогона.
 */

const mark = Date.now().toString(36)
const SUB = `conn${mark}`

let headers: Record<string, string> = {}
let crystal = ''
let fresh = ''

async function platformToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
  expect(response.ok(), `вход в консоль -> ${response.status()}`).toBeTruthy()
  return (await response.json()).access
}

async function enter(page: Page, hotelId: string, tab: string) {
  const tokens = await (await page.request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })).json()
  await page.goto('/admin')
  await page.evaluate(([a, r]) => {
    window.localStorage.clear()
    window.localStorage.setItem('itv.platform.access', a)
    window.localStorage.setItem('itv.platform.refresh', r)
  }, [tokens.access, tokens.refresh])
  await page.goto(`/admin?section=fleet&hotel=${hotelId}&tab=${tab}`)
}

async function dropServer(request: APIRequestContext) {
  const gone = await request.delete(`${API}/api/v1/platform/hotels/${crystal}/control-server`, { headers })
  expect(gone.ok(), await gone.text()).toBeTruthy()
}

test.describe.serial('Подключение управления номером', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000)
    headers = { Authorization: `Bearer ${await platformToken(request)}` }
    const list = await (await request.get(`${API}/api/v1/platform/hotels?limit=1000`, { headers })).json()
    crystal = (list.items ?? list).find((h: { subdomain: string }) => h.subdomain === 'crystal').id
    await dropServer(request)
    const created = await request.post(`${API}/api/v1/platform/hotels`, {
      data: { subdomain: SUB, name: `Подключение ${mark}`, admin_email: `admin@${SUB}.test`, origin: 'test' },
      headers,
    })
    expect(created.ok(), await created.text()).toBeTruthy()
    const body = await created.json()
    fresh = body.hotel?.id ?? body.id
    await request.put(`${API}/api/v1/platform/hotels/${fresh}/modules/room_control`, { data: { enabled: true }, headers })
  })

  test.afterAll(async ({ request }) => {
    await dropServer(request)
  })

  test('мастер от начала до «готово», затем постоянный экран', async ({ page }) => {
    test.setTimeout(150_000)
    await enter(page, crystal, 'connections')
    const screen = page.getByTestId('admin-conn-screen')
    await expect(screen).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('admin-conn-source')).toContainText('задан на сервере отеля', { timeout: 30_000 })

    await page.getByTestId('admin-conn-wizard-open').click()
    const wizard = page.getByTestId('admin-conn-wizard')
    await expect(wizard.getByTestId('admin-conn-wiz-step-what')).toBeVisible()
    await expect(wizard.getByTestId('admin-conn-chain')).toBeVisible()
    await wizard.getByTestId('admin-conn-wiz-next').click()

    // 2. Коннектор уже на связи — идти дальше можно без нового ключа.
    await expect(wizard.getByTestId('admin-conn-wiz-online')).toBeVisible({ timeout: 20_000 })
    await wizard.getByTestId('admin-conn-wiz-next').click()

    // 3. Сервер: Bittel и «другое» — «скоро», выбрать нельзя.
    await expect(wizard.getByTestId('admin-conn-kind-bittel')).toBeDisabled()
    await expect(wizard.getByTestId('admin-conn-kind-other')).toBeDisabled()
    await wizard.getByTestId('admin-conn-host').fill('iridi-emulator')
    await wizard.getByTestId('admin-conn-port').fill('1085')
    await wizard.getByTestId('admin-conn-auth-token').click()
    await wizard.getByTestId('admin-conn-secret').fill('e2e-63-3-token')
    await wizard.getByTestId('admin-conn-save').click()
    await expect(wizard.getByTestId('admin-conn-apply')).toHaveAttribute('data-tone', 'ok', { timeout: 20_000 })
    // Секрет назад на экран не приходит — только «задан» и «изменить».
    await expect(wizard.getByTestId('admin-conn-secret-set')).toBeVisible()
    await expect(wizard.getByTestId('admin-conn-secret')).toHaveCount(0)
    await wizard.getByTestId('admin-conn-check').click()
    await expect(wizard.getByTestId('admin-conn-check-result')).toHaveAttribute('data-tone', 'ok', { timeout: 20_000 })
    await expect(wizard.getByTestId('admin-conn-check-result')).toContainText('адрес задан в Control')
    await wizard.getByTestId('admin-conn-wiz-next').click()

    // 4. Проверка номера — только чтение.
    await expect(wizard.getByTestId('admin-conn-room')).toBeVisible({ timeout: 20_000 })
    await wizard.getByTestId('admin-conn-room-read').click()
    await expect(wizard.getByTestId('admin-conn-room-result')).toHaveAttribute('data-ok', 'true', { timeout: 30_000 })
    await expect(wizard.getByTestId('admin-conn-room-result')).toContainText('только чтение')
    await wizard.getByTestId('admin-conn-wiz-next').click()

    // 5. Готово.
    await expect(wizard.getByTestId('admin-conn-wiz-summary')).toContainText('iridi-emulator:1085')
    await wizard.getByTestId('admin-conn-wiz-close').click()
    await expect(wizard).toHaveCount(0)

    // Постоянный экран после мастера: адрес из Control, цепочка зелёная.
    await expect(page.getByTestId('admin-conn-source')).toContainText('задан в Control', { timeout: 20_000 })
    await expect(page.getByTestId('admin-conn-address')).toContainText('iridi-emulator:1085')
    for (const link of ['cloud', 'connector', 'server', 'rooms']) {
      await expect(page.getByTestId(`admin-conn-link-${link}`)).toHaveAttribute('data-tone', 'ok')
    }
    await page.getByTestId('admin-conn-check').click()
    await expect(page.getByTestId('admin-conn-check-result')).toHaveAttribute('data-tone', 'ok', { timeout: 20_000 })
  })

  test('адрес вне разрешённого круга — понятная ошибка, коннектор остаётся на файле', async ({ page }) => {
    test.setTimeout(90_000)
    await enter(page, crystal, 'connections')
    await expect(page.getByTestId('admin-conn-screen')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('admin-conn-edit').click()
    const sheet = page.getByTestId('admin-conn-edit-dialog')
    await sheet.getByTestId('admin-conn-host').fill('10.9.9.9')
    await sheet.getByTestId('admin-conn-auth-none').click()
    await sheet.getByTestId('admin-conn-save').click()
    await expect(sheet).toHaveCount(0)
    const apply = page.getByTestId('admin-conn-apply')
    await expect(apply).toHaveAttribute('data-tone', 'bad', { timeout: 20_000 })
    await expect(apply).toContainText('10.9.9.9:1085 вне разрешённого круга')
    await expect(apply).toContainText('Что делать')
    // Отказ — коннектор остался на адресе из файла и сервер отвечает.
    await page.getByTestId('admin-conn-check').click()
    await expect(page.getByTestId('admin-conn-check-result')).toHaveAttribute('data-tone', 'ok', { timeout: 20_000 })
    await expect(page.getByTestId('admin-conn-check-result')).toContainText('задан на сервере отеля')
  })

  test('из Обзора — в мастер; новый коннектор: ключ, команда, ожидание связи', async ({ page }) => {
    test.setTimeout(90_000)
    await enter(page, fresh, 'overview')
    await page.getByTestId('admin-overview-connect-open').click({ timeout: 30_000 })
    const wizard = page.getByTestId('admin-conn-wizard')
    await expect(wizard).toBeVisible()
    await expect(page).toHaveURL(/tab=connections/)
    await wizard.getByTestId('admin-conn-wiz-next').click()
    await wizard.getByTestId('admin-conn-circle').fill('10.10.20.0/24')
    await wizard.getByTestId('admin-conn-issue').click()
    const command = wizard.getByTestId('admin-conn-command')
    await expect(command).toContainText('"allowedTargets"')
    await expect(command).toContainText('"net": "10.10.20.0/24"')
    await expect(command).toContainText('/ws/v1/onprem/connector')
    await expect(wizard.getByTestId('admin-conn-wiz-wait')).toHaveAttribute('data-online', 'false')
    // Дальше нельзя, пока коннектор не на связи.
    await expect(wizard.getByTestId('admin-conn-wiz-next')).toBeDisabled()
  })
})
