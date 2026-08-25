import { expect, test, type Page } from '@playwright/test'

import { API, ADMIN, login } from './helpers'

/**
 * Вход под аудитом целиком: код в адресе, баннер у отеля, отзыв на лету.
 *
 * Три дыры одного механизма, поэтому и проверка одна сквозная — по браузеру,
 * а не по ручкам. Именно в браузере видно то, ради чего всё делалось: что
 * токен не остался в адресной строке, что отель видит чужое присутствие
 * своими глазами, и что после отзыва живая вкладка поддержки перестаёт
 * работать, а не «перестанет при следующем входе».
 */

const PLATFORM = { email: 'platform@itv.local', password: 'platform12345' }
const DEMO = 'crystal'

async function loginToAdmin(page: Page): Promise<void> {
  await page.goto('/admin')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/admin')
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 15_000 })
}

async function openHotelCard(page: Page): Promise<void> {
  await page.getByTestId('admin-nav-fleet').click()
  await page.getByTestId('admin-fleet-search').fill(DEMO)
  await page.getByTestId(`admin-fleet-open-${DEMO}`).click()
  await expect(page.getByTestId('admin-hotel')).toBeVisible({ timeout: 15_000 })
}

/**
 * Войти в отель через диалог и открыть CMS в соседней вкладке.
 *
 * Кнопка «Открыть CMS» ведёт на поддомен отеля (`crystal.guest.localhost`),
 * а он в деве не резолвится: поддомены поднимаются только на стенде. Поэтому
 * код берём ИЗ ОТВЕТА, который получил диалог, и открываем ту же ссылку на
 * доступном хосте — механизм проверяется тот же самый, меняется только адрес.
 */
async function enterHotel(page: Page, reason: string): Promise<{ cms: Page; grantId: string }> {
  await page.getByTestId('admin-hotel-enter').click()
  await page.getByTestId('admin-enter-reason').fill(reason)

  const granted = page.waitForResponse(
    (r) => r.url().includes('/enter') && r.request().method() === 'POST',
  )
  await page.getByTestId('admin-enter-submit').click()
  const body = await (await granted).json()
  await expect(page.getByTestId('admin-enter-granted')).toBeVisible({ timeout: 15_000 })

  // Заодно: наружу уехал код, а не токен. Ищем ПО ФОРМЕ, а не по имени поля.
  expect(JSON.stringify(body), 'в ответе на вход лежит JWT').not.toContain('eyJ')
  // Панель отеля живёт в `/admin` НА ЕГО СОБСТВЕННОМ адресе: и хост, и путь
  // здесь одинаково важны — ссылка на `/admin` базового хоста открыла бы нашу
  // консоль, а не панель отеля.
  expect(body.cms_url, 'ссылка должна вести в панель отеля').toMatch(
    /^https?:\/\/[^/]+\/admin$/,
  )
  expect(body.cms_url, 'ссылка должна вести на адрес отеля').toContain('crystal.')

  const cms = await page.context().newPage()
  await cms.goto(`/cms#support=${encodeURIComponent(body.code)}`)
  // Обмен кода на токен идёт при загрузке; готовность — это адрес CMS, а не
  // страница входа.
  await expect(cms).toHaveURL(/\/cms/, { timeout: 25_000 })
  await expect(cms.getByTestId('login-submit')).toHaveCount(0)
  return { cms, grantId: body.grant_id }
}

test.describe('Вход под аудитом', () => {
  test('код в адресе, а не токен, и он стирается из истории', async ({ page }) => {
    await loginToAdmin(page)
    await openHotelCard(page)
    const { cms } = await enterHotel(page, 'e2e: адресная строка')

    const url = cms.url()
    // JWT узнаётся по форме, а не по имени параметра: приехать он мог под любым.
    expect(url, `токен в адресной строке: ${url}`).not.toContain('eyJ')
    // И одноразовый код тоже не остался — иначе он лежал бы в истории вкладки.
    expect(url).not.toContain('support=')

    await cms.close()
  })

  test('отель видит чужое присутствие и не может его убрать', async ({ page, browser }) => {
    await loginToAdmin(page)
    await openHotelCard(page)
    const { cms } = await enterHotel(page, 'e2e: баннер присутствия')

    // Отель входит СВОИМ входом и из ОТДЕЛЬНОГО контекста: поддержка и
    // администратор — разные люди за разными машинами, а в одном контексте
    // это было бы одно хранилище и один токен на двоих.
    const hotelCtx = await browser.newContext()
    const hotelTab = await hotelCtx.newPage()
    await login(hotelTab, ADMIN)

    const banner = hotelTab.getByTestId('cms-support-presence')
    await expect(banner).toBeVisible({ timeout: 20_000 })
    await expect(banner).toContainText(PLATFORM.email)
    // Скрыть нечем: ни крестика, ни «оборвать» — решение осознанное.
    await expect(banner.getByRole('button')).toHaveCount(0)

    await hotelCtx.close()
    await cms.close()
  })

  test('отзыв обрывает уже открытую сессию на следующем запросе', async ({ page }) => {
    await loginToAdmin(page)
    await openHotelCard(page)
    const { cms, grantId } = await enterHotel(page, 'e2e: отзыв на лету')

    // Отзываем из консоли — вкладку поддержки при этом не трогаем.
    await page.getByTestId('admin-enter-granted').getByRole('button', { name: /Готово|Done/ }).click()
    await page.getByTestId('admin-hotel-tab-support').click()
    // Рвём ИМЕННО свою сессию: на стенде рядом живут чужие, и «первая в
    // списке» проверяла бы не то.
    const row = page.getByTestId(`admin-support-revoke-${grantId}`)
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.click()
    await expect(page.getByTestId(`admin-support-row-${grantId}`)).toHaveCount(0, {
      timeout: 15_000,
    })

    // Живая вкладка поддержки: следующий же запрос отвергнут.
    const rejected = cms.waitForResponse(
      (r) => r.url().includes('/api/v1/') && [401, 403].includes(r.status()),
      { timeout: 25_000 },
    )
    await cms.reload()
    await rejected
    // И её выкидывает на вход, а не оставляет с картинкой прошлой сессии.
    await expect(cms.getByTestId('login-submit')).toBeVisible({ timeout: 20_000 })

    await cms.close()
  })

  test('список активных сессий пуст, когда никого нет', async ({ page, request }) => {
    const token = await request
      .post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
      .then((r) => r.json())
      .then((j) => j.access)
    // Прибираем хвосты прошлых прогонов: список утверждает «сейчас никого».
    const rows = await request
      .get(`${API}/api/v1/platform/impersonations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((r) => r.json())
      .then((page) => page.items)
    for (const row of rows as { id: string }[]) {
      await request.post(`${API}/api/v1/platform/impersonations/${row.id}/revoke`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    }

    await loginToAdmin(page)
    await page.getByTestId('admin-nav-support').click()
    await expect(page.getByTestId('admin-support-sessions')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('state-empty')).toBeVisible()
  })
})
