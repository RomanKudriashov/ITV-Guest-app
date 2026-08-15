import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { API } from './helpers'

/**
 * Действия, которые API умел, а интерфейс не давал.
 *
 * ДВА РУБЕЖА ПРОВЕРЯЮТСЯ ОТДЕЛЬНО. Сервер обязан отказать роли без права —
 * это защита. Экран обязан не показывать кнопку, которой сервер откажет, — это
 * честность. Проверка только сервера пропустит интерфейс, обещающий
 * невозможное; проверка только экрана пропустит дыру в правах.
 *
 * РАЗРУШАЮЩЕЕ — ТОЛЬКО НА ОДНОРАЗОВОМ ОТЕЛЕ. Три настоящих отеля стенда
 * (crystal, azure, lumen) не трогаются: одноразовый заводится из шаблона в
 * начале и убирается тем же действием, которое проверяется.
 */

const PLATFORM = { email: 'platform@itv.local', password: 'platform12345' }

async function ownerToken(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
  expect(resp.ok(), await resp.text()).toBeTruthy()
  return (await resp.json()).access
}

/** Учётка с ролью «только чтение»: свой пароль, свой токен. */
async function readOnlyAccount(request: APIRequestContext) {
  const owner = await ownerToken(request)
  const invited = await request
    .post(`${API}/api/v1/platform/team`, {
      data: { email: `eyes-${Date.now()}@platform.test`, role: 'read_only' },
      headers: { Authorization: `Bearer ${owner}` },
    })
    .then((r) => r.json())
  const login = await request
    .post(`${API}/api/v1/platform/auth/login`, {
      data: { email: invited.member.email, password: invited.password },
    })
    .then((r) => r.json())
  return { email: invited.member.email, password: invited.password, token: login.access }
}

/** Одноразовый отель из шаблона — им и только им проверяется разрушающее. */
async function disposableHotel(request: APIRequestContext, token: string) {
  const subdomain = `throw${Date.now().toString(36)}`
  const created = await request.post(`${API}/api/v1/platform/hotels`, {
    data: {
      subdomain,
      name: `Одноразовый ${subdomain}`,
      admin_email: `a@${subdomain}.test`,
      template: 'blank',
    },
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  return { id: (await created.json()).hotel.id, subdomain }
}

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/admin')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/admin')
  await page.getByTestId('admin-login-email').fill(email)
  await page.getByTestId('admin-login-password').fill(password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 30_000 })
}

async function openHotel(page: Page, subdomain: string) {
  await page.getByTestId('admin-nav-fleet').click()
  await page.getByTestId('admin-fleet-search').fill(subdomain)
  await page.getByTestId(`admin-fleet-open-${subdomain}`).click()
  await expect(page.getByTestId('admin-hotel')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('admin-hotel-tab-data').click()
}

test.describe('Консоль: разрушающее и ключи', () => {
  test('очистка и удаление: два шага, оба с вводом поддомена', async ({ page, request }) => {
    test.setTimeout(120_000)
    const owner = await ownerToken(request)
    const hotel = await disposableHotel(request, owner)

    await loginAs(page, PLATFORM.email, PLATFORM.password)
    await openHotel(page, hotel.subdomain)

    // Шаг первый: пометка к офбордингу. Без неё очистки нет.
    await page.getByTestId('admin-data-reason').fill('e2e: проверка разрушающего')
    await page.getByTestId('admin-data-mark').click()
    await expect(page.getByTestId('admin-data-marked')).toBeVisible({ timeout: 20_000 })

    // Шаг второй: очистка. Кнопка заперта, пока поддомен не набран руками.
    await expect(page.getByTestId('admin-data-purge')).toBeDisabled()
    await page.getByTestId('admin-data-confirm').fill(hotel.subdomain)
    await page.getByTestId('admin-data-purge').click()
    await expect(page.getByTestId('admin-data-purged')).toBeVisible({ timeout: 30_000 })

    // Удаление строки — отдельная панель и отдельное подтверждение.
    await expect(page.getByTestId('admin-data-delete')).toBeDisabled()
    await page.getByTestId('admin-data-delete-confirm').fill(hotel.subdomain)
    await page.getByTestId('admin-data-delete').click()

    // Отель не всплывает в списках.
    await expect
      .poll(
        async () => {
          const fleet = await request
            .get(`${API}/api/v1/platform/fleet?search=${hotel.subdomain}&origin=all`, {
              headers: { Authorization: `Bearer ${owner}` },
            })
            .then((r) => r.json())
          return fleet.items.length
        },
        { timeout: 20_000 },
      )
      .toBe(0)

    // И запись об удалении есть в журнале.
    const audit = await request
      .get(`${API}/api/v1/platform/audit?action=platform.hotel.deleted&limit=20`, {
        headers: { Authorization: `Bearer ${owner}` },
      })
      .then((r) => r.json())
    expect(
      audit.items.some(
        (row: { payload: { subdomain?: string } }) => row.payload?.subdomain === hotel.subdomain,
      ),
      'удаление отеля обязано быть в журнале',
    ).toBeTruthy()
  })

  test('разрушающее: роль без права не видит кнопок И получает отказ', async ({
    browser,
    request,
  }) => {
    const owner = await ownerToken(request)
    const hotel = await disposableHotel(request, owner)
    const eyes = await readOnlyAccount(request)

    // Рубеж первый — сервер.
    const purged = await request.post(`${API}/api/v1/platform/hotels/${hotel.id}/purge`, {
      data: { confirm_subdomain: hotel.subdomain },
      headers: { Authorization: `Bearer ${eyes.token}` },
    })
    expect(purged.status(), 'очистка ролью «только чтение»').toBe(403)
    const removed = await request.delete(
      `${API}/api/v1/platform/hotels/${hotel.id}?confirm_subdomain=${hotel.subdomain}`,
      { headers: { Authorization: `Bearer ${eyes.token}` } },
    )
    expect(removed.status(), 'удаление ролью «только чтение»').toBe(403)

    // Рубеж второй — экран.
    const ctx = await browser.newContext({ locale: 'ru-RU' })
    const page = await ctx.newPage()
    await loginAs(page, eyes.email, eyes.password)
    await openHotel(page, hotel.subdomain)
    await expect(page.getByTestId('admin-data-delete-panel')).toHaveCount(0)
    await expect(page.getByTestId('admin-data-purge')).toHaveCount(0)
    await ctx.close()

    // Прибираем за собой одноразовый отель.
    await request.delete(
      `${API}/api/v1/platform/hotels/${hotel.id}?confirm_subdomain=${hotel.subdomain}`,
      { headers: { Authorization: `Bearer ${owner}` } },
    )
  })

  test('узел заводится с экрана, ключ показан один раз', async ({ page, request }) => {
    const owner = await ownerToken(request)
    const hotel = await disposableHotel(request, owner)

    await loginAs(page, PLATFORM.email, PLATFORM.password)
    await page.getByTestId('admin-nav-nodes').click()
    await page.getByTestId('admin-node-create').click()

    // MUI-селект открывается списком, а не нативным `select`: тест-идентификатор
    // стоит на скрытом input, кликать надо по видимой части.
    await page.getByTestId('admin-node-hotel').locator('..').click()
    await page.locator(`li[data-value="${hotel.id}"]`).click()
    await page.getByTestId('admin-node-name').fill('e2e-узел')
    await page.getByTestId('admin-node-create-submit').click()

    const key = page.getByTestId('admin-node-key')
    await expect(key).toBeVisible({ timeout: 20_000 })
    // Подпись «один раз» стоит рядом с самим ключом.
    await expect(key).toContainText(/один раз|once/i)

    // Второй раз тот же ключ не показывается: перезагрузка его не вернёт.
    await page.reload()
    await expect(page.getByTestId('admin-node-key')).toHaveCount(0)

    await request.delete(
      `${API}/api/v1/platform/hotels/${hotel.id}?confirm_subdomain=${hotel.subdomain}`,
      { headers: { Authorization: `Bearer ${owner}` } },
    )
  })

  test('ключ перевыпускается ЖИВОМУ узлу, с предупреждением', async ({ page, request }) => {
    const owner = await ownerToken(request)
    const hotel = await disposableHotel(request, owner)
    const node = await request
      .post(`${API}/api/v1/platform/hotels/${hotel.id}/nodes`, {
        data: { name: 'живой', purpose: 'grms' },
        headers: { Authorization: `Bearer ${owner}` },
      })
      .then((r) => r.json())
    expect(node.node.is_revoked, 'узел заводится живым').toBeFalsy()

    await loginAs(page, PLATFORM.email, PLATFORM.password)
    await page.getByTestId('admin-nav-nodes').click()

    // Раньше кнопка была только у отозванного: чтобы сменить ключ, надо было
    // сначала уронить связь. Теперь она есть у живого — и предупреждает.
    const reissue = page.getByTestId('admin-node-reissue-живой')
    await expect(reissue).toBeVisible({ timeout: 20_000 })

    let warned = ''
    page.once('dialog', (dialog) => {
      warned = dialog.message()
      void dialog.accept()
    })
    await reissue.click()

    await expect(page.getByTestId('admin-node-key')).toBeVisible({ timeout: 20_000 })
    expect(warned, 'предупреждение о смерти старого ключа').toMatch(/перестанет работать|переподключ/i)

    await request.delete(
      `${API}/api/v1/platform/hotels/${hotel.id}?confirm_subdomain=${hotel.subdomain}`,
      { headers: { Authorization: `Bearer ${owner}` } },
    )
  })

  test('смена адреса администратора: владельцу — да, поддержке — нет', async ({
    browser,
    request,
  }) => {
    const owner = await ownerToken(request)
    const hotel = await disposableHotel(request, owner)

    // Рубеж первый — сервер: поддержка получает отказ.
    const invited = await request
      .post(`${API}/api/v1/platform/team`, {
        data: { email: `support-${Date.now()}@platform.test`, role: 'support' },
        headers: { Authorization: `Bearer ${owner}` },
      })
      .then((r) => r.json())
    const support = await request
      .post(`${API}/api/v1/platform/auth/login`, {
        data: { email: invited.member.email, password: invited.password },
      })
      .then((r) => r.json())
    const refused = await request.put(`${API}/api/v1/platform/hotels/${hotel.id}/admins/email`, {
      data: { current_email: `a@${hotel.subdomain}.test`, new_email: 'moved@test.test' },
      headers: { Authorization: `Bearer ${support.access}` },
    })
    expect(refused.status(), 'смена адреса поддержкой').toBe(403)

    // Рубеж второй — экран: поддержка не видит формы.
    const ctx = await browser.newContext({ locale: 'ru-RU' })
    const page = await ctx.newPage()
    await loginAs(page, invited.member.email, invited.password)
    await page.getByTestId('admin-nav-fleet').click()
    await page.getByTestId('admin-fleet-search').fill(hotel.subdomain)
    await page.getByTestId(`admin-fleet-open-${hotel.subdomain}`).click()
    await expect(page.getByTestId('admin-hotel')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('admin-hotel-admin-move')).toHaveCount(0)
    await ctx.close()

    // А владелец — меняет.
    const ownerCtx = await browser.newContext({ locale: 'ru-RU' })
    const ownerPage = await ownerCtx.newPage()
    await loginAs(ownerPage, PLATFORM.email, PLATFORM.password)
    await ownerPage.getByTestId('admin-nav-fleet').click()
    await ownerPage.getByTestId('admin-fleet-search').fill(hotel.subdomain)
    await ownerPage.getByTestId(`admin-fleet-open-${hotel.subdomain}`).click()
    await ownerPage.getByTestId('admin-hotel-admin-email').fill(`a@${hotel.subdomain}.test`)
    await ownerPage.getByTestId('admin-hotel-admin-new-email').fill(`moved@${hotel.subdomain}.test`)
    const moved = ownerPage.waitForResponse(
      (r) => r.url().includes('/admins/email') && r.request().method() === 'PUT',
    )
    await ownerPage.getByTestId('admin-hotel-admin-move').click()
    expect((await moved).ok(), 'смена адреса владельцем').toBeTruthy()
    await ownerCtx.close()

    await request.delete(
      `${API}/api/v1/platform/hotels/${hotel.id}?confirm_subdomain=${hotel.subdomain}`,
      { headers: { Authorization: `Bearer ${owner}` } },
    )
  })

  test('второй фактор: экран показывает состояние своей учётки', async ({ page }) => {
    await loginAs(page, PLATFORM.email, PLATFORM.password)
    await page.getByTestId('admin-nav-security').click()

    await expect(page.getByTestId('admin-security')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('admin-security-status')).toBeVisible()

    // Начало настройки выдаёт секрет — тот самый шаг, которого не было вовсе.
    await page.getByTestId('admin-security-enable').click()
    await expect(page.getByTestId('admin-security-secret')).toBeVisible({ timeout: 20_000 })
    // Неверный код не включает второй фактор.
    await page.getByTestId('admin-security-code').fill('000000')
    await page.getByTestId('admin-security-confirm').click()
    await expect(page.getByTestId('admin-security-error')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('admin-security-status')).toContainText(/выключен|off/i)
  })
})
