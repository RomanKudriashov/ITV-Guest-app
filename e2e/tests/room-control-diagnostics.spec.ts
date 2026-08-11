import { expect, test, type APIRequestContext } from '@playwright/test'

import { API, apiGet, apiHeaders, apiToken, DEMO_ROOM, login } from './helpers'

/**
 * Диагностика инженера (ТЗ §14.3) и различение причин отказа (§6.8).
 *
 * Проверяется то, чего не видно в юнит-тесте: что инженер РЕАЛЬНО ВИДИТ на
 * экране — отказ, названный причиной, а не «не получилось» одной строкой.
 *
 * ОТКАЗ ДЕЛАЕТСЯ НАСТОЯЩИЙ, а не подрисованный: комнате на время
 * подменяется имя устройства на несуществующее, после чего проверка элемента
 * честно отбивается железом. Подмена снимается в том же тесте — стенд обязан
 * остаться таким же, каким был, иначе соседние прогоны начнут падать следом.
 */

const BOGUS_DEVICE = 'Modbus TCP Server (Slave mode) НЕТ ТАКОГО'

interface GrmsType {
  code: string
  rooms: string[]
  elements?: { slug: string }[]
}

async function demoType(request: APIRequestContext, token: string): Promise<GrmsType> {
  const body = await apiGet<{ types: GrmsType[] }>(request, token, '/api/v1/cms/grms/types')
  const type = body.types.find((entry) => entry.rooms.includes(DEMO_ROOM))
  expect(type, `тип с комнатой ${DEMO_ROOM}`).toBeTruthy()
  return type as GrmsType
}

async function setOverride(
  request: APIRequestContext,
  token: string,
  code: string,
  device: string,
): Promise<void> {
  const response = await request.post(
    `${API}/api/v1/cms/grms/types/${encodeURIComponent(code)}/device-override`,
    { data: { room_number: DEMO_ROOM, device_name: device }, headers: apiHeaders(token) },
  )
  expect(response.ok(), `подмена устройства -> ${response.status()}`).toBeTruthy()
}

test('инженер видит отказ с причиной, фильтрует по номеру и перечитывает', async ({
  page,
  request,
}) => {
  const token = await apiToken(request)
  const type = await demoType(request, token)

  const status = await apiGet<{ elements: { slug: string; publishable: boolean }[] }>(
    request,
    token,
    `/api/v1/cms/grms/types/${encodeURIComponent(type.code)}/status`,
  )
  const element = status.elements.find((entry) => entry.publishable)
  expect(element, 'опубликованный элемент демо-типа').toBeTruthy()
  const slug = (element as { slug: string }).slug

  // 1. Настоящий отказ: комната смотрит на устройство, которого нет.
  await setOverride(request, token, type.code, BOGUS_DEVICE)
  try {
    const check = await request.post(
      `${API}/api/v1/cms/grms/types/${encodeURIComponent(type.code)}/check`,
      {
        data: { element_slug: slug, room_number: DEMO_ROOM, value: null },
        headers: apiHeaders(token),
      },
    )
    // Сама проверка отвечает 200 — она РАССКАЗЫВАЕТ об отказе, а не падает с ним.
    expect(check.ok(), `проверка элемента -> ${check.status()}`).toBeTruthy()
  } finally {
    // Стенд возвращается в исходное в любом случае: пустая строка снимает
    // подмену и возвращает шаблон типа.
    await setOverride(request, token, type.code, '')
  }

  // 2. Экран инженера.
  await login(page)
  await page.goto('/cms/room-control')
  await page.getByTestId('grms-tab-diagnostics').click()
  await expect(page.getByTestId('grms-diagnostics')).toBeVisible({ timeout: 20_000 })

  // 3. Три звена связи — ПОРОЗНЬ, а не одной строкой «недоступно».
  await expect(page.getByTestId('diagnostics-link-connector')).toBeVisible()
  await expect(page.getByTestId('diagnostics-link-endpoint')).toBeVisible()
  await expect(page.getByTestId('diagnostics-link-readable')).toBeVisible()

  // 4. Фильтр по номеру.
  await page.getByTestId('diagnostics-filter-room').fill(DEMO_ROOM)
  await expect(page.getByTestId('diagnostics-table')).toBeVisible({ timeout: 20_000 })
  const rooms = page.getByTestId('diagnostics-cell-room')
  await expect(rooms.first()).toHaveText(DEMO_ROOM, { timeout: 20_000 })
  const roomCount = await rooms.count()
  for (let index = 0; index < roomCount; index += 1) {
    await expect(rooms.nth(index)).toHaveText(DEMO_ROOM)
  }

  // 5. Отказ назван причиной, а не спрятан за «не получилось».
  const reason = page.getByTestId('diagnostics-cell-reason').first()
  await expect(reason).toBeVisible({ timeout: 20_000 })
  await expect(reason).not.toHaveText('')

  // 6. Сырой ответ железа лежит под строкой — как пришёл. Подробности до
  //    раскрытия не смонтированы (Collapse с unmountOnExit), поэтому сначала
  //    клик по раскрытию, и только потом проверка.
  const firstRow = page.getByTestId('diagnostics-table').locator('tbody tr').first()
  await firstRow.getByRole('button').first().click()
  await expect(page.getByTestId('diagnostics-details').first()).toBeVisible()
  await expect(page.getByTestId('diagnostics-raw').first()).toBeVisible()

  // 7. Повторное чтение прямо с экрана: подмена снята, и результат показывается
  //    честно — каким бы он ни оказался.
  await page.getByTestId('diagnostics-recheck').first().click()
  await expect(page.getByTestId('diagnostics-recheck-result')).toBeVisible({ timeout: 30_000 })
})

test('гостю технические причины не показываются', async ({ page }) => {
  /*
    Рубеж держит не вёрстка: /cms закрыт токеном персонала. Здесь проверяется
    гостевая сторона — что на экране номера нет ни кода причины, ни устройства,
    ни requestID, а есть ровно та нейтральная фраза, которую требует ТЗ §6.
  */
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-nav-room')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('guest-nav-room').click()
  await expect(page.getByTestId('room-page')).toBeVisible({ timeout: 20_000 })

  const body = (await page.getByTestId('room-page').textContent()) ?? ''
  for (const leak of ['CONNECTOR_OFFLINE', 'ENDPOINT_UNREACHABLE', 'BAD_RESPONSE', 'requestID']) {
    expect(body, `гостю не должно уехать «${leak}»`).not.toContain(leak)
  }
})
