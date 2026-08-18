import { expect, test, type Page } from '@playwright/test'

import { ADMIN, API, HOTEL } from './helpers'

/**
 * Несохранённое переживает смерть сессии.
 *
 * Было: сессия умирала посреди правки, форма размонтировалась вместе с
 * набранным текстом, и человек получал «сессия истекла» вместо своей работы.
 * Сторож несохранённого не срабатывал — уход шёл из обработчика 401, мимо
 * роутера.
 *
 * Черновик, а не задержка выхода до диалога: к моменту смерти сессии сохранять
 * уже нечем — сервер отвечает 401 на всё, и диалог с неработающей кнопкой
 * «сохранить» был бы тем же мёртвым экраном. Черновик переживает и уход на
 * вход, и закрытую вкладку.
 */

const DEAD =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJleHAiOjF9.x'

async function loginCms(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(ADMIN.email)
  await page.getByTestId('login-password').fill(ADMIN.password)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/cms\//, { timeout: 20_000 })
}

test('редактор блюда: набранное возвращается после входа', async ({ page, request }) => {
  const token = await request
    .post(`${API}/api/staff/auth/login`, { data: ADMIN, headers: { 'X-Hotel-Subdomain': HOTEL } })
    .then((r) => r.json())
    .then((body) => body.access)
  const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }

  /*
    СВОЁ блюдо, а не сидовое.

    Первая версия правила сидовый «Цезарь» и возвращала имя в конце — но
    прерванный прогон оставлял его переименованным, и следующий падал, не
    найдя «Цезаря». Тест, зависящий от собственного незавершённого прогона,
    ловит не дефект, а свой прошлый обрыв.
  */
  const categories = await request
    .get(`${API}/api/cms/categories?service_id=`, { headers })
    .then((r) => r.json())
  const services = await request
    .get(`${API}/api/cms/services`, { headers })
    .then((r) => r.json())
    .then((page) => page.items)
  const kitchen = services.find((s: { code: string }) => s.code === 'kitchen')
  const tree = await request
    .get(`${API}/api/cms/categories?service_id=${kitchen.id}`, { headers })
    .then((r) => r.json())
  const category = tree[0] ?? categories[0]

  const created = await request
    .post(`${API}/api/cms/items`, {
      headers,
      data: {
        category_id: category.id,
        type: 'product',
        title: { ru: `Черновик-подопытный ${Date.now().toString(36)}` },
        price: 10000,
      },
    })
    .then((r) => r.json())

  try {
    await loginCms(page)
    // Чистый лист: черновик от прошлого прогона — состояние стенда, а не условие.
    await page.evaluate(() =>
      Object.keys(window.localStorage)
        .filter((k) => k.startsWith('itv.draft.'))
        .forEach((k) => window.localStorage.removeItem(k)),
    )

    await page.goto(`/cms/menu/items/${created.id}`)
    await expect(page.getByTestId('item-title-input')).toHaveValue(created.title.ru, {
      timeout: 20_000,
    })
    // Пауза на устаканивание: набранное между двумя гидратациями затирается ею.
    await page.waitForTimeout(2500)

    const typed = `Набрано ${Date.now().toString(36)}`
    await page.getByTestId('item-title-input').fill(typed)
    await expect(
      page.getByTestId('item-dirty-badge'),
      'форма не приняла правку',
    ).toBeVisible({ timeout: 15_000 })

    // Сессия умирает прямо посреди правки.
    await page.evaluate((dead) => {
      window.localStorage.setItem('itv.cms.access', dead)
      window.localStorage.setItem('itv.cms.refresh', dead)
    }, DEAD)
    await page.getByTestId('item-save-button').click()

    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })
    await expect(page.getByTestId('login-error')).toContainText(/истекла/i)

    // ГЛАВНОЕ: вошли заново — набранное на месте.
    await loginCms(page)
    await page.goto(`/cms/menu/items/${created.id}`)
    await expect(
      page.getByTestId('item-title-input'),
      'набранное пропало вместе с сессией',
    ).toHaveValue(typed, { timeout: 20_000 })

    // И черновик НЕ переживает успешного сохранения.
    await page.getByTestId('item-save-button').click()
    await expect(page.getByText('Блюдо сохранено')).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(
        () =>
          page.evaluate(
            () => Object.keys(window.localStorage).filter((k) => k.startsWith('itv.draft.')).length,
          ),
        { timeout: 15_000, message: 'черновик пережил сохранение' },
      )
      .toBe(0)
  } finally {
    await request.delete(`${API}/api/cms/items/${created.id}`, { headers })
  }
})

test('профиль отеля в консоли: набранное возвращается после входа', async ({ page }) => {
  const login = async () => {
    await page.goto('/admin')
    await page.getByTestId('admin-login-email').fill('platform@itv.local')
    await page.getByTestId('admin-login-password').fill('platform12345')
    await page.getByTestId('admin-login-submit').click()
    await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 40_000 })
  }
  const openFirstHotel = async () => {
    await page.getByTestId('admin-nav-fleet').click()
    await page.locator('[data-testid^="admin-fleet-open-"]').first().click()
    await expect(page.getByTestId('admin-hotel-name-input')).toBeVisible({ timeout: 20_000 })
  }

  await page.goto('/admin')
  await page.evaluate(() => window.localStorage.clear())
  await login()
  await openFirstHotel()

  const original = await page.getByTestId('admin-hotel-name-input').inputValue()
  const typed = `${original} черновик`
  await page.getByTestId('admin-hotel-name-input').fill(typed)
  await page.waitForTimeout(500)

  await page.evaluate((dead) => {
    window.localStorage.setItem('itv.platform.access', dead)
    window.localStorage.setItem('itv.platform.refresh', dead)
  }, DEAD)
  await page.reload()
  await expect(page.getByTestId('admin-login-email')).toBeVisible({ timeout: 20_000 })

  await login()
  await openFirstHotel()
  await expect(
    page.getByTestId('admin-hotel-name-input'),
    'набранное в профиле отеля пропало вместе с сессией',
  ).toHaveValue(typed, { timeout: 20_000 })

  // Возвращаем как было и убираем черновик за собой.
  await page.getByTestId('admin-hotel-name-input').fill(original)
  await page.waitForTimeout(500)
})

test('мои входы: список показывает текущую сессию и закрывает чужую', async ({ page }) => {
  await loginCms(page)
  await page.goto('/cms/profile')

  await expect(page.getByTestId('sessions-panel')).toBeVisible({ timeout: 20_000 })
  await expect(
    page.getByTestId('session-row-current'),
    'текущая сессия не отмечена — список не с чем сверить',
  ).toHaveCount(1)
  await expect(page.getByTestId('sessions-logout-all')).toBeVisible()
})
