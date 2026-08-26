import { expect, test, type APIRequestContext } from '@playwright/test'

import { API, PLATFORM } from './helpers'

/**
 * ГРУППЫ ОТЕЛЕЙ на экране консоли.
 *
 * Серверная половина — `backend/tests/hotels/test_hotel_groups.py`. Здесь
 * проверяется то, чего в ней не видно: что оператор видит состав, различает
 * два вида групп и режет флот группой.
 *
 * Отели заводятся прогоном и убираются за собой: уборка набора чистит то,
 * чего не было в снимке «до», но группы в снимок не входят, поэтому их
 * удаляем сами.
 */

const uniq = () => Date.now().toString().slice(-6)

async function token(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
  expect(response.ok(), `вход в консоль -> ${response.status()}`).toBeTruthy()
  return (await response.json()).access
}

test('УКУС: группа-правило пересчитывается — отель, заведённый позже, уже в ней', async ({
  page,
  request,
}) => {
  const access = await token(request)
  const headers = { Authorization: `Bearer ${access}` }
  const mark = uniq()
  const city = `Гроздовск-${mark}`

  // 1. Правило заводим ДО отелей: состав пустой, и это видно.
  const created = await request.post(`${API}/api/v1/platform/groups`, {
    data: { code: `rule-${mark}`, title: `Правило ${mark}`, kind: 'city', mode: 'rule', rule: { city } },
    headers,
  })
  expect(created.ok(), `создание группы -> ${created.status()}`).toBeTruthy()
  const group = await created.json()
  expect(group.size, 'у пустого правила состав пуст').toBe(0)

  // 2. Заводим отель с этим городом ПОСЛЕ группы.
  const hotel = await request.post(`${API}/api/v1/platform/hotels`, {
    data: {
      subdomain: `grp${mark}`,
      name: `Гроздовск ${mark}`,
      admin_email: `admin${mark}@example.test`,
      // Признак автотеста: так наши отели отличимы от настоящих по полю, а не
      // угадыванием по имени.
      origin: 'test',
    },
    headers,
  })
  expect(hotel.ok(), `создание отеля -> ${hotel.status()} ${await hotel.text()}`).toBeTruthy()
  const body = await hotel.json()
  const hotelId = body.hotel?.id ?? body.id

  // Город ставится правкой профиля — тем же путём, которым его ставит оператор.
  const patched = await request.patch(`${API}/api/v1/platform/hotels/${hotelId}`, {
    data: { city: { ru: city } },
    headers,
  })
  expect(patched.ok(), `город -> ${patched.status()} ${await patched.text()}`).toBeTruthy()

  // 3. Экран консоли: в группе стало на один больше, и он там БЕЗ автора —
  //    его туда положило условие, а не человек.
  await page.goto('/admin')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/admin')
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 30_000 })

  await page.goto('/admin?section=groups')
  await expect(page.getByTestId('admin-groups')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId(`admin-group-open-rule-${mark}`).click()

  const row = page.getByTestId(`admin-group-member-grp${mark}`)
  await expect(row, 'отель, заведённый после группы, обязан попасть в неё сам').toBeVisible({
    timeout: 20_000,
  })
  await expect(row).toContainText('по правилу')

  // 4. Тот же состав — у фильтра флота. Спрашиваем сервер напрямую с
  //    `origin=all`: экран флота по умолчанию показывает боевые отели, а наш
  //    заведён с признаком автотеста, и его строки там нет по этой причине, а
  //    не из-за группы.
  const filtered = await request.get(
    `${API}/api/v1/platform/fleet?group=${group.id}&origin=all`,
    { headers },
  )
  const page1 = await filtered.json()
  expect(page1.total, 'фильтр флота и правило обязаны считать состав одинаково').toBe(1)
  expect(page1.items[0].subdomain).toBe(`grp${mark}`)

  // 5. Панель массового действия на экране адресуется группой БЕЗ единой
  //    галочки — и берёт размер с сервера, а не со страницы.
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await page.goto('/admin?section=fleet')
  await expect(page.getByTestId('admin-fleet')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('admin-fleet-group').click()
  await page.getByRole('option', { name: new RegExp(`Правило ${mark}`) }).click()
  await expect(page.getByTestId('admin-fleet-bulkbar')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('admin-fleet-bulkbar')).toContainText('1')

  // Убираем за собой: группа и отель.
  await request.delete(`${API}/api/v1/platform/groups/${group.id}`, { headers })
  if (hotelId) {
    await request.delete(
      `${API}/api/v1/platform/hotels/${hotelId}?confirm_subdomain=grp${mark}`,
      { headers },
    )
  }
})
