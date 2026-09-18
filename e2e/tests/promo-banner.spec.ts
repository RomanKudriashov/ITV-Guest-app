import { expect, test } from './fixtures'

import { ADMIN, API, HOTEL, apiHeaders, apiToken, guestSession, signIn } from './helpers'

/**
 * Рекламный баннер на витрине (пункт 20).
 *
 * Проверяем путь целиком по API и один раз глазами: баннер, заведённый в CMS,
 * доезжает до гостя, считается один раз на сессию, закрывается и больше не
 * возвращается. Всё, что зажигаем на стенде, гасим в конце: проверка, которая
 * оставляет след, сама становится состоянием стенда.
 */
const PLATFORM = { email: 'platform@itv.local', password: 'platform12345' }

async function setMarketing(request: import('@playwright/test').APIRequestContext, on: boolean) {
  const login = await request.post(`${API}/api/platform/auth/login`, { data: PLATFORM })
  const token = (await login.json()).access
  // ИЩЕМ отель поиском: у выдачи флота есть предел, и на большом стенде
  // демо-отель не попадает на первую страницу.
  const hotels = await request
    .get(`${API}/api/v1/platform/fleet?search=${HOTEL}&origin=all`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then((r) => r.json())
  const hotel = hotels.items.find((row: { subdomain: string }) => row.subdomain === HOTEL)
  const answer = await request.put(`${API}/api/platform/hotels/${hotel.id}/modules`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { modules: [{ code: 'marketing', is_enabled: on, source: 'override' }] },
  })
  expect(answer.ok(), await answer.text()).toBeTruthy()
}

test('баннер доезжает до гостя, считается один раз и закрывается навсегда', async ({ request }) => {
  await setMarketing(request, true)
  const token = await apiToken(request)
  const created = await request.post(`${API}/api/cms/banners`, {
    headers: apiHeaders(token),
    data: {
      name: 'E2E спа-акция',
      title: { ru: 'Спа со скидкой', en: 'Spa offer' },
      size: 'm',
      placement: 'top',
      action: 'link',
      action_url: 'https://example.com/spa',
      priority: 100,
    },
  })
  expect(created.status(), await created.text()).toBe(201)
  const banner = await created.json()

  try {
    const guest = await guestSession(request)
    const guestHeaders = { Authorization: `Bearer ${guest}`, 'X-Hotel-Subdomain': HOTEL }

    // Витрина рисуется без рекламы: баннер приезжает СВОЕЙ ручкой.
    const home = await request.get(`${API}/api/guest/home`, { headers: guestHeaders })
    expect(Object.keys(await home.json())).not.toContain('banner')

    // Гость ходит по витрине — знаменатель CTR от этого расти не должен.
    for (let i = 0; i < 3; i += 1) {
      const answer = await request.get(`${API}/api/guest/banner`, { headers: guestHeaders })
      expect((await answer.json()).banner.id).toBe(banner.id)
    }
    await request.post(`${API}/api/guest/banner/${banner.id}/click`, { headers: guestHeaders })

    const afterViews = await request.get(`${API}/api/cms/banners`, { headers: apiHeaders(token) })
    const stats = (await afterViews.json()).items.find(
      (row: { id: string }) => row.id === banner.id,
    ).stats
    expect(stats.impressions).toBe(1)
    expect(stats.clicks).toBe(1)
    expect(stats.reached).toBe(1)
    expect(stats.ctr).toBe(1)

    // Закрыт — и в этой сессии не возвращается.
    await request.post(`${API}/api/guest/banner/${banner.id}/close`, { headers: guestHeaders })
    const closed = await request.get(`${API}/api/guest/banner`, { headers: guestHeaders })
    expect((await closed.json()).banner).toBeNull()

    // Новый гость видит его снова: закрытие — свойство сессии, не баннера.
    const next = await guestSession(request, '201')
    const forNext = await request.get(`${API}/api/guest/banner`, {
      headers: { Authorization: `Bearer ${next}`, 'X-Hotel-Subdomain': HOTEL },
    })
    expect((await forNext.json()).banner.id).toBe(banner.id)
  } finally {
    await request.delete(`${API}/api/cms/banners/${banner.id}`, { headers: apiHeaders(token) })
    await setMarketing(request, false)
  }
})

test('баннер виден на витрине и закрывается кнопкой', async ({ page, request }) => {
  await setMarketing(request, true)
  const token = await apiToken(request)
  const created = await request.post(`${API}/api/cms/banners`, {
    headers: apiHeaders(token),
    data: {
      name: 'E2E глазами',
      title: { ru: 'Спа со скидкой', en: 'Spa offer' },
      size: 'l',
      placement: 'top',
      priority: 100,
    },
  })
  const banner = await created.json()

  try {
    await page.goto(`/r/305`)
    await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
    const strip = page.getByTestId('guest-banner')
    await expect(strip).toBeVisible({ timeout: 20_000 })
    await expect(strip).toHaveAttribute('data-banner-size', 'l')
    await expect(page.getByTestId('guest-banner-title')).toContainText('Спа со скидкой')

    await page.getByTestId('guest-banner-close').click()
    await expect(strip).toHaveCount(0)

    // Перезагрузка не воскрешает закрытое: состояние живёт на СЕРВЕРЕ, а не
    // в памяти вкладки.
    await page.reload()
    await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('guest-banner')).toHaveCount(0)
  } finally {
    await request.delete(`${API}/api/cms/banners/${banner.id}`, { headers: apiHeaders(token) })
    await setMarketing(request, false)
  }
})

test('раздел баннеров живёт в маркетинге и показывает статистику', async ({ page, request }) => {
  await setMarketing(request, true)
  const token = await apiToken(request)
  const created = await request.post(`${API}/api/cms/banners`, {
    headers: apiHeaders(token),
    data: { name: 'E2E в CMS', priority: 1 },
  })
  const banner = await created.json()

  try {
    await signIn(page, ADMIN)
    await page.goto('/cms/marketing')
    await page.getByTestId('cms-marketing-tab-banners').click()
    await expect(page.getByTestId(`cms-banner-${banner.id}`)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId(`cms-banner-stats-${banner.id}`)).toContainText('CTR')
  } finally {
    await request.delete(`${API}/api/cms/banners/${banner.id}`, { headers: apiHeaders(token) })
    await setMarketing(request, false)
  }
})
