import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken, signIn, unique } from './helpers'

/**
 * КОРПУС — СПРАВОЧНИК (пункт 14 разбора).
 *
 * Было: свободная строка `zone` в карточке номера. «Главный корпус»,
 * «главный корпус» и «Гл. корпус» жили как три разных здания — фильтр делил
 * фонд на три части, притом что здание одно.
 *
 * Проверка сама за собой убирает: заводит свой корпус и удаляет его в конце,
 * иначе она сама станет состоянием стенда.
 */
test('корпус заводится, выбирается у номера и фильтрует фонд', async ({ page, request }) => {
  const token = await apiToken(request)
  const title = `Корпус ${unique('b')}`

  const created = await request.post(`${API}/api/cms/buildings`, {
    headers: apiHeaders(token),
    data: { title: { ru: title } },
  })
  expect(created.status(), await created.text()).toBe(201)
  const building = await created.json()

  const rooms = await (
    await request.get(`${API}/api/cms/rooms?limit=1`, { headers: apiHeaders(token) })
  ).json()
  const room = rooms.items[0]
  const before = room.building_id ?? null

  try {
    await signIn(page, ADMIN)
    await page.goto('/cms/rooms')

    // Справочник открывается рядом с категориями — это два справочника
    // одного экрана.
    await page.getByTestId('room-buildings-open').click()
    const dialog = page.getByTestId('rooms-buildings-dialog')
    await expect(dialog).toBeVisible({ timeout: 20_000 })
    await expect(dialog).toContainText(title)
    await page.keyboard.press('Escape')

    // Выбор корпуса у номера — из списка, а не строкой.
    const patched = await request.patch(`${API}/api/cms/rooms/${room.id}`, {
      headers: apiHeaders(token),
      data: { building_id: building.id },
    })
    expect(patched.status(), await patched.text()).toBe(200)
    expect((await patched.json()).building.title).toBe(title)

    // Фильтр по корпусу отбирает ровно его номера.
    const filtered = await (
      await request.get(`${API}/api/cms/rooms?building_id=${building.id}`, {
        headers: apiHeaders(token),
      })
    ).json()
    expect(filtered.items.map((entry: { id: string }) => entry.id)).toEqual([room.id])
  } finally {
    await request.patch(`${API}/api/cms/rooms/${room.id}`, {
      headers: apiHeaders(token),
      data: { building_id: before },
    })
    await request.delete(`${API}/api/cms/buildings/${building.id}`, { headers: apiHeaders(token) })
  }
})

test('занятый корпус не удаляется молча', async ({ request }) => {
  const token = await apiToken(request)
  const created = await request.post(`${API}/api/cms/buildings`, {
    headers: apiHeaders(token),
    data: { title: { ru: `Занятый ${unique('b')}` } },
  })
  const building = await created.json()
  const rooms = await (
    await request.get(`${API}/api/cms/rooms?limit=1`, { headers: apiHeaders(token) })
  ).json()
  const room = rooms.items[0]
  const before = room.building_id ?? null

  try {
    await request.patch(`${API}/api/cms/rooms/${room.id}`, {
      headers: apiHeaders(token),
      data: { building_id: building.id },
    })
    const refused = await request.delete(`${API}/api/cms/buildings/${building.id}`, {
      headers: apiHeaders(token),
    })
    expect(refused.status()).toBe(409)
    const body = await refused.json()
    expect(body.code).toBe('building_in_use')
    // Число в отказе: «переназначьте» без числа не говорит, сколько работы.
    expect(body.rooms_count).toBeGreaterThan(0)
  } finally {
    await request.patch(`${API}/api/cms/rooms/${room.id}`, {
      headers: apiHeaders(token),
      data: { building_id: before },
    })
    await request.delete(`${API}/api/cms/buildings/${building.id}`, { headers: apiHeaders(token) })
  }
})
