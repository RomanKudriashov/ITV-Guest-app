import { type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, PLATFORM } from './helpers'

/**
 * НЕСКОЛЬКО ПОДКЛЮЧЕНИЙ У ОТЕЛЯ (партия 65, правка 1).
 *
 * У отеля два подключения управления номером — «по умолчанию» и второе со
 * своим коннектором. Номер назначается подключению пакетным действием, и это
 * видно везде, где есть номер: в таблице, на схеме слоем, в карточке.
 *
 * Свой отель прогона (`origin=test`): коннекторы, подключения и номера —
 * только его.
 */

const mark = Date.now().toString(36)
const SUB = `conn${mark}`

let headers: Record<string, string> = {}
let hotelId = ''
let second = ''

async function token(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
  expect(response.ok(), `вход в консоль -> ${response.status()}`).toBeTruthy()
  return (await response.json()).access
}

test.describe.serial('Подключения: несколько у отеля, номер — своему', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000)
    headers = { Authorization: `Bearer ${await token(request)}` }
    const created = await request.post(`${API}/api/v1/platform/hotels`, {
      data: { subdomain: SUB, name: `Подключения ${mark}`, admin_email: `admin@${SUB}.test`, origin: 'test' },
      headers,
    })
    expect(created.ok(), await created.text()).toBeTruthy()
    const body = await created.json()
    hotelId = body.hotel?.id ?? body.id
    await request.put(`${API}/api/v1/platform/hotels/${hotelId}/modules/room_control`, { data: { enabled: true }, headers })
    await request.post(`${API}/api/v1/platform/hotels/${hotelId}/rooms/bulk`, { headers, data: { spec: '100-103' } })
    const emu = await (await request.post(`${API}/api/v1/platform/hotels/${hotelId}/nodes`, { headers, data: { name: 'Эмулятор', purpose: 'grms' } })).json()
    const real = await (await request.post(`${API}/api/v1/platform/hotels/${hotelId}/nodes`, { headers, data: { name: 'Объект', purpose: 'grms' } })).json()
    const first = await request.put(`${API}/api/v1/platform/hotels/${hotelId}/control-server`, {
      headers,
      data: { name: 'Эмулятор (демо)', host: 'iridi-emulator', port: 1085, node_id: emu.node.id },
    })
    expect(first.ok(), await first.text()).toBeTruthy()
    const made = await request.put(`${API}/api/v1/platform/hotels/${hotelId}/control-server?new=1`, {
      headers,
      data: { name: 'iRidi объекта', host: '192.168.155.17', port: 1085, node_id: real.node.id },
    })
    expect(made.ok(), await made.text()).toBeTruthy()
    second = (await made.json()).server.id
  })

  test.afterAll(async ({ request }) => {
    if (hotelId) await request.delete(`${API}/api/v1/platform/hotels/${hotelId}?confirm_subdomain=${SUB}`, { headers })
  })

  async function enter(page: import('@playwright/test').Page, query: string) {
    const tokens = await (await page.request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })).json()
    await page.goto('/admin')
    await page.evaluate(([a, r]) => {
      window.localStorage.clear()
      window.localStorage.setItem('itv.platform.access', a)
      window.localStorage.setItem('itv.platform.refresh', r)
    }, [tokens.access, tokens.refresh])
    await page.goto(`/admin?section=fleet&hotel=${hotelId}${query}`)
  }

  test('«Подключения»: оба в списке, «по умолчанию» первым', async ({ page }) => {
    await enter(page, '&tab=connections')
    const list = page.getByTestId('admin-connections-list')
    await expect(list).toBeVisible({ timeout: 30_000 })
    const rows = list.locator('[data-testid^="admin-connection-"][data-default]')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toHaveAttribute('data-default', 'true')
    await expect(page.getByTestId(`admin-connection-${second}`)).toContainText('iRidi объекта')
  })

  test('пакетом: номер 100 — на второе подключение; таблица и карточка это показывают', async ({ page }) => {
    test.setTimeout(120_000)
    await enter(page, '&tab=rooms&view=table')
    await expect(page.getByTestId('admin-rooms-table')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('admin-room-100').locator('input[type="checkbox"]').check()
    await page.locator('[data-testid^="admin-rooms-batch-"]').filter({ hasText: 'Подключение' }).first().click()
    await page.getByTestId('admin-rooms-batch-preview').click()
    await page.getByTestId('admin-rooms-batch-shown').waitFor({ timeout: 20_000 })
    await page.getByTestId('admin-rooms-batch-run').click()
    await expect(page.getByTestId('admin-room-connection-100')).toContainText('iRidi объекта', { timeout: 20_000 })
    await expect(page.getByTestId('admin-room-connection-101')).toContainText('по умолчанию')
  })
})
