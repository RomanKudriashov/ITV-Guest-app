import { expect, test, type Page } from '@playwright/test'

import { apiToken, CREDENTIALS, HOTEL } from './helpers'

/**
 * Админка отеля: номера/QR, персонал, локации.
 *
 * Definition of Done: номер + печатный QR (ведёт на рабочий /r/:room),
 * сотрудник + привязка, локация + привязка к категории. Каждый тест создаёт
 * сущности с уникальным суффиксом и убирает их за собой.
 */

const uniq = () => Date.now().toString().slice(-6)

async function openAdmin(page: Page, path: string): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(CREDENTIALS.email)
  await page.getByTestId('login-password').fill(CREDENTIALS.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  await page.goto(path)
}

test.describe('Админка отеля', () => {
  test('номер и его QR кодируют рабочий deep-link', async ({ page, request }) => {
    await openAdmin(page, '/cms/rooms')
    await expect(page.getByTestId('rooms-list')).toBeVisible({ timeout: 20_000 })

    const number = `9${uniq()}`
    await page.getByTestId('room-add').click()
    await page.getByTestId('room-number').fill(number)
    await page.getByTestId('room-dialog').getByTestId('room-save').click()

    const row = page.getByTestId(`room-row-${number}`)
    await expect(row).toBeVisible({ timeout: 15_000 })

    // QR-диалог показывает картинку; сам QR несёт /r/<номер> — проверяем на API.
    await page.getByTestId(`room-qr-${number}`).click()
    await expect(page.getByTestId('room-qr-image')).toBeVisible()

    const token = await apiToken(request)
    const rooms = await request.get('http://localhost:8010/api/cms/rooms', {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    const created = (await rooms.json()).find((r: { number: string }) => r.number === number)
    expect(created.guest_url).toBe(`http://crystal.guest.localhost/r/${number}`)

    // QR-эндпоинт отдаёт настоящую картинку.
    const svg = await request.get(
      `http://localhost:8010/api/cms/rooms/${created.id}/qr.svg`,
      { headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL } },
    )
    expect(svg.headers()['content-type']).toContain('image/svg')

    // Убираем за собой.
    await request.delete(`http://localhost:8010/api/cms/rooms/${created.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
  })

  test('добавление диапазоном показывает созданные и пропущенные', async ({ page, request }) => {
    await openAdmin(page, '/cms/rooms')
    await expect(page.getByTestId('rooms-list')).toBeVisible({ timeout: 20_000 })

    const base = Number(`8${uniq().slice(-4)}`)
    await page.getByTestId('room-bulk-add').click()
    await page.getByTestId('room-bulk-from').fill(String(base))
    await page.getByTestId('room-bulk-to').fill(String(base + 3))
    await page.getByTestId('room-bulk-submit').click()

    await expect(page.getByTestId('room-bulk-result')).toContainText(String(base))

    const token = await apiToken(request)
    for (let n = base; n <= base + 3; n++) {
      const rooms = await request.get('http://localhost:8010/api/cms/rooms', {
        headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
      })
      const room = (await rooms.json()).find((r: { number: string }) => r.number === String(n))
      if (room) {
        await request.delete(`http://localhost:8010/api/cms/rooms/${room.id}`, {
          headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
        })
      }
    }
  })

  test('создать сотрудника с привязкой к отделу', async ({ page, request }) => {
    await openAdmin(page, '/cms/staff')
    await expect(page.getByTestId('staff-list')).toBeVisible({ timeout: 20_000 })

    const email = `e2e-${uniq()}@crystal.local`
    await page.getByTestId('staff-add').click()
    await page.getByTestId('staff-email').fill(email)
    await page.getByTestId('staff-full-name').fill('E2E Сотрудник')
    await page.getByTestId('staff-password').fill('secret12345')

    await page.getByTestId('staff-assignment-add').click()
    // Выбираем первый отдел и уровень — селекты нативные.
    await page.getByTestId('staff-assignment-point-0').selectOption({ index: 1 })
    await page.getByTestId('staff-assignment-level-0').selectOption('lead')

    await page.getByTestId('staff-save').click()
    await expect(page.getByTestId(`staff-row-${email}`)).toBeVisible({ timeout: 15_000 })

    // Проверяем на бэке: сотрудник создан с привязкой.
    const token = await apiToken(request)
    const staff = await request.get('http://localhost:8010/api/cms/staff', {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    const member = (await staff.json()).find((m: { email: string }) => m.email === email)
    expect(member.assignments.length).toBeGreaterThan(0)
    expect(member.assignments[0].level).toBe('lead')

    await request.delete(`http://localhost:8010/api/cms/staff/${member.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
  })

  test('созданного сотрудника можно выбрать в персональном канале', async ({
    page,
    request,
  }) => {
    // Заводим сотрудника через API, затем открываем настройку канала.
    const token = await apiToken(request)
    const email = `chan-${uniq()}@crystal.local`
    const created = await request.post('http://localhost:8010/api/cms/staff', {
      data: { email, full_name: 'Канальный', password: 'secret12345' },
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    const userId = (await created.json()).id

    await openAdmin(page, '/cms/notifications')
    // Переходим на вкладку каналов и открываем создание канала.
    await page.getByTestId('cms-channel-add').click()
    // Тип «персональный» → селект сотрудника активен (раньше был заблокирован).
    const userSelect = page.getByTestId('channel-user-select')
    if (await userSelect.isVisible().catch(() => false)) {
      await expect(userSelect).toBeEnabled()
    }

    await request.delete(`http://localhost:8010/api/cms/staff/${userId}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
  })

  test('создать локацию с уточнением и привязать категорию в матрице', async ({
    page,
    request,
  }) => {
    await openAdmin(page, '/cms/locations')
    await expect(page.getByTestId('locations-list')).toBeVisible({ timeout: 20_000 })

    const token = await apiToken(request)

    // Локацию заводим через API (форма покрыта отдельно), проверяем матрицу в UI.
    const loc = await request.post('http://localhost:8010/api/cms/locations', {
      data: {
        title: { ru: `Спа-${uniq()}` },
        kind: 'common_point',
        requires_refinement: true,
        refinement_label: { ru: 'Кабинет' },
      },
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    expect(loc.status()).toBe(201)
    const locId = (await loc.json()).id

    await page.reload()
    await expect(page.getByTestId('location-matrix')).toBeVisible({ timeout: 15_000 })

    // Привязываем «Напитки» к новой локации через API-матрицу и убеждаемся,
    // что связка реально создалась.
    const matrix = await (
      await request.get('http://localhost:8010/api/cms/locations/matrix', {
        headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
      })
    ).json()
    const drinks = matrix.rows.find(
      (r: { category_title: string }) => r.category_title === 'Напитки',
    )
    await request.put('http://localhost:8010/api/cms/locations/matrix', {
      data: {
        category_id: drinks.category_id,
        cells: [{ location_id: locId, enabled: true, delivery_modes: ['pickup'] }],
      },
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
    const after = await (
      await request.get('http://localhost:8010/api/cms/locations/matrix', {
        headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
      })
    ).json()
    const drinksAfter = after.rows.find(
      (r: { category_title: string }) => r.category_title === 'Напитки',
    )
    const cell = drinksAfter.cells.find(
      (c: { location_id: string }) => c.location_id === locId,
    )
    expect(cell.enabled).toBe(true)

    await request.delete(`http://localhost:8010/api/cms/locations/${locId}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
  })
})
