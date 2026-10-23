import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, PLATFORM } from './helpers'

/**
 * НОМЕРНОЙ ФОНД — ДЕЙСТВИЯ НАД МНОГИМИ НОМЕРАМИ (партия 63-2). Серверная
 * половина — `backend/tests/hotels/test_room_batch_63_2.py`.
 *
 * Свой отель прогона (`origin=test`), 12 номеров на двух этажах: выбор рамкой,
 * «весь стояк», показ → выполнение, лист PIN показан один раз.
 */

const mark = Date.now().toString(36)
const SUB = `batch${mark}`

let headers: Record<string, string> = {}
let hotelId = ''

async function platformToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
  expect(response.ok(), `вход в консоль -> ${response.status()}`).toBeTruthy()
  return (await response.json()).access
}

async function enter(page: Page) {
  const tokens = await (await page.request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })).json()
  await page.goto('/admin')
  await page.evaluate(([a, r]) => {
    window.localStorage.clear()
    window.localStorage.setItem('itv.platform.access', a)
    window.localStorage.setItem('itv.platform.refresh', r)
  }, [tokens.access, tokens.refresh])
  await page.goto(`/admin?section=fleet&hotel=${hotelId}&tab=rooms`)
  await expect(page.getByTestId('admin-rooms-fix')).toBeVisible({ timeout: 30_000 })
}

const selectedNumbers = (page: Page) =>
  page.locator('[data-testid^="admin-room-"][data-selected="true"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')!.replace('admin-room-', '')).sort())

async function roomId(request: APIRequestContext, number: string): Promise<string> {
  const map = await (await request.get(`${API}/api/v1/platform/hotels/${hotelId}/rooms/map?search=${number}`, { headers })).json()
  for (const b of map.buildings) for (const f of b.floors) for (const r of f.rooms) if (r.number === number) return r.id
  throw new Error(`нет номера ${number}`)
}

test.describe.serial('Номерной фонд — действия над многими номерами', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000)
    headers = { Authorization: `Bearer ${await platformToken(request)}` }
    const created = await request.post(`${API}/api/v1/platform/hotels`, {
      data: { subdomain: SUB, name: `Пачка ${mark}`, admin_email: `admin@${SUB}.test`, origin: 'test' },
      headers,
    })
    expect(created.ok(), await created.text()).toBeTruthy()
    const body = await created.json()
    hotelId = body.hotel?.id ?? body.id
    await request.put(`${API}/api/v1/platform/hotels/${hotelId}/modules/room_control`, { data: { enabled: true }, headers })
    const made = await request.post(`${API}/api/v1/platform/hotels/${hotelId}/rooms/bulk`, { data: { spec: '2201-2206, 3301-3306' }, headers })
    expect(made.ok(), await made.text()).toBeTruthy()
  })

  test.afterAll(async ({ request }) => {
    if (!hotelId) return
    await request.post(`${API}/api/v1/platform/hotels/${hotelId}/purge`, { data: { confirm: SUB }, headers })
    await request.delete(`${API}/api/v1/platform/hotels/${hotelId}`, { headers })
  })

  test('выбор рамкой: номера, которых коснулась рамка; Shift-щелчок добавляет', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await enter(page)
    // Схема ниже первого экрана — сначала прокрутить к ней, иначе мышь жмёт мимо окна.
    await page.getByTestId('admin-room-2205').scrollIntoViewIfNeeded()
    const top = (await page.getByTestId('admin-room-3306').boundingBox())!
    const bottom = (await page.getByTestId('admin-room-2205').boundingBox())!
    // С пустого места справа от ряда (за кнопкой «+» этажа) — к середине 2205:
    // задевает 3305, 3306, 2205, 2206.
    const sx = top.x + top.width + 120
    const sy = top.y + top.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move(bottom.x + bottom.width / 2, bottom.y + bottom.height / 2, { steps: 8 })
    await expect(page.getByTestId('admin-rooms-marquee')).toBeVisible()
    await page.mouse.up()
    await expect.poll(() => selectedNumbers(page)).toEqual(['2205', '2206', '3305', '3306'])
    await expect(page.getByTestId('admin-rooms-selection-count')).toHaveText('Выбрано 4 номера')
    await page.getByTestId('admin-room-2201').click({ modifiers: ['Shift'] })
    await expect.poll(() => selectedNumbers(page)).toEqual(['2201', '2205', '2206', '3305', '3306'])
    // Обычный щелчок открывает номер, а не выбирает.
    await expect(page.getByTestId('admin-room-dialog')).toHaveCount(0)
    await page.getByTestId('admin-rooms-selection-clear').click()
    await expect(page.getByTestId('admin-rooms-selection')).toHaveCount(0)
  })

  test('«весь стояк» и «весь этаж» выбирают ровно свои номера', async ({ page }) => {
    await enter(page)
    await page.getByTestId('admin-rooms-select-stack-none-03').click()
    await expect.poll(() => selectedNumbers(page)).toEqual(['2203', '3303'])
    await page.getByTestId('admin-rooms-select-stack-none-03').click()
    await expect.poll(() => selectedNumbers(page)).toEqual([])
    await page.getByTestId('admin-rooms-select-floor-none-33').click()
    await expect.poll(() => selectedNumbers(page)).toEqual(['3301', '3302', '3303', '3304', '3305', '3306'])
  })

  test('показ → выполнение: «вне продажи» у двух номеров, в «Истории» одна запись', async ({ page, request }) => {
    await enter(page)
    await page.getByTestId('admin-room-2201').click({ modifiers: ['Shift'] })
    await page.getByTestId('admin-room-2202').click({ modifiers: ['Meta'] })
    await page.getByTestId('admin-rooms-batch-state').click()
    await page.getByTestId('admin-rooms-batch-state-out_of_service:true').click()
    await page.getByTestId('admin-rooms-batch-preview').click()
    await expect(page.getByTestId('admin-rooms-batch-summary')).toContainText('Изменится — 2')
    await expect(page.getByTestId('admin-rooms-batch-row-2201')).toHaveAttribute('data-outcome', 'change')
    await page.getByTestId('admin-rooms-batch-run').click()
    await expect(page.getByTestId('admin-rooms-batch-done')).toContainText('Сделано: 2')
    await page.getByTestId('admin-rooms-batch-close').click()
    await expect(page.getByTestId('admin-rooms-selection')).toHaveCount(0)
    for (const number of ['2201', '2202']) {
      const detail = await (await request.get(`${API}/api/v1/platform/hotels/${hotelId}/rooms/${await roomId(request, number)}/detail`, { headers })).json()
      expect(detail.out_of_service, `${number} не «вне продажи»`).toBe(true)
    }
    const history = await (await request.get(`${API}/api/v1/platform/hotels/${hotelId}/history?what=rooms`, { headers })).json()
    expect(history.items.filter((i: { action: string }) => i.action === 'room.batch')).toHaveLength(1)
  })

  test('PIN пачкой: лист «номер — PIN» показан один раз', async ({ page }) => {
    await enter(page)
    await page.getByTestId('admin-room-3301').click({ modifiers: ['Shift'] })
    await page.getByTestId('admin-room-3302').click({ modifiers: ['Shift'] })
    await page.getByTestId('admin-rooms-batch-pin').click()
    await page.getByTestId('admin-rooms-batch-preview').click()
    await expect(page.getByTestId('admin-rooms-batch-summary')).toContainText('Изменится — 2')
    await page.getByTestId('admin-rooms-batch-run').click()
    const sheet = page.getByTestId('admin-rooms-pin-sheet')
    await expect(sheet).toBeVisible()
    await expect(page.getByTestId('admin-rooms-pin-3301')).toContainText(/\d{6}/)
    await expect(page.getByTestId('admin-rooms-pin-3302')).toContainText(/\d{6}/)
    const download = page.waitForEvent('download')
    await page.getByTestId('admin-rooms-pins-csv').click()
    expect((await download).suggestedFilename()).toMatch(/^pin-.*\.csv$/)
    // Первое «Готово» — предупреждение, второе — закрывает навсегда.
    await page.getByTestId('admin-rooms-batch-close').click()
    await expect(page.getByTestId('admin-rooms-pins-close-warning')).toBeVisible()
    await page.getByTestId('admin-rooms-batch-close').click()
    await expect(page.getByTestId('admin-rooms-batch-dialog')).toHaveCount(0)
    // Окно номера говорит «PIN действует», но кода больше нигде нет.
    await page.getByTestId('admin-room-3301').click()
    await page.getByTestId('admin-room-tab-access').click()
    await expect(page.getByTestId('admin-room-pin-state')).toContainText('PIN действует')
    await expect(page.getByTestId('admin-rooms-pin-sheet')).toHaveCount(0)
    await expect(page.getByTestId('admin-room-pin-shown')).toHaveCount(0)
  })
})
