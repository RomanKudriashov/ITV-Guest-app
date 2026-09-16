import { expect, test, type APIRequestContext } from '@playwright/test'

import {
  ADMIN,
  API,
  CREDENTIALS,
  HOTEL,
  RESTAURANT_MANAGER,
  signIn,
  signInToCms,
  staffToken,
} from './helpers'

/**
 * КОНТАКТЫ СОТРУДНИКА.
 *
 * Повар — линейный сотрудник: разделов CMS у него нет, но профиль свой, и
 * мессенджер он подключает именно там. Кнопка «подключить» без бота честно
 * говорит «пока недоступно» и не нажимается — рабочей заглушка не выглядит.
 *
 * Телефон — контакт человека: видят его он сам и администратор отеля, а
 * управляющий — нет. Номер повара тест ставит явно и возвращает прежний.
 */

const CHEF_EMAIL = CREDENTIALS.email

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }
}

async function ownPhone(request: APIRequestContext, token: string): Promise<string> {
  const response = await request.get(`${API}/api/staff/me/contacts`, { headers: headers(token) })
  expect(response.status(), await response.text()).toBe(200)
  return (await response.json()).phone
}

async function setOwnPhone(request: APIRequestContext, token: string, phone: string) {
  const response = await request.patch(`${API}/api/staff/me/contacts`, {
    data: { phone },
    headers: headers(token),
  })
  expect(response.status(), await response.text()).toBe(200)
}

test.describe('Контакты сотрудника', () => {
  test.describe.configure({ mode: 'serial' })

  let chefToken = ''
  let original = ''

  test.beforeAll(async ({ request }) => {
    chefToken = await staffToken(request, CREDENTIALS)
    original = await ownPhone(request, chefToken)
    await setOwnPhone(request, chefToken, '')
  })

  test.afterAll(async ({ request }) => {
    await setOwnPhone(request, chefToken || (await staffToken(request, CREDENTIALS)), original)
  })

  test('повар открывает свой профиль, сохраняет телефон и видит честное «пока недоступно»', async ({
    page,
    request,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await signIn(page, CREDENTIALS)
    await page.goto('/cms/profile')

    // Не отказ «сюда нельзя», а свой экран.
    await expect(page.getByTestId('profile-contacts')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('cms-profile')).toBeVisible()

    await page.getByTestId('profile-phone').fill('8 (916) 555-01-02')
    await page.getByTestId('profile-phone-save').click()
    await expect.poll(() => ownPhone(request, chefToken)).toBe('+79165550102')
    await expect(page.getByTestId('profile-phone')).toHaveValue('+79165550102')

    for (const messenger of ['telegram', 'max']) {
      const connect = page.getByTestId(`profile-messenger-${messenger}-connect`)
      await expect(connect, messenger).toBeVisible()
      await expect(connect, `${messenger}: кнопка не должна притворяться рабочей`).toBeDisabled()
      await expect(page.getByTestId(`profile-messenger-${messenger}-unavailable`)).toBeVisible()
    }

    // И сервер говорит то же самое, что экран.
    const code = await request.post(`${API}/api/staff/me/contacts/telegram/binding-code`, {
      headers: headers(chefToken),
    })
    expect(code.status()).toBe(409)
    expect(await code.text()).toContain('binding_unavailable')
    expect(errors, errors.join(' | ')).toEqual([])
  })

  test('неверный номер не сохраняется и объясняет почему', async ({ page, request }) => {
    await signIn(page, CREDENTIALS)
    await page.goto('/cms/profile')
    await page.getByTestId('profile-phone').fill('123')
    await page.getByTestId('profile-phone-save').click()
    await expect(page.getByTestId('profile-contacts')).toContainText(/8 .*15/)
    expect(await ownPhone(request, chefToken)).toBe('+79165550102')
  })

  test('телефон видит администратор отеля, но не управляющий', async ({ page, request }) => {
    await signInToCms(page, ADMIN)
    await page.goto('/cms/staff')
    await expect(page.getByTestId(`staff-phone-${CHEF_EMAIL}`)).toHaveText('+79165550102', {
      timeout: 20_000,
    })

    const managerToken = await staffToken(request, RESTAURANT_MANAGER)
    const list = await request.get(`${API}/api/cms/staff?limit=200`, {
      headers: headers(managerToken),
    })
    expect(list.status()).toBe(200)
    const chef = (await list.json()).items.find(
      (item: { email: string }) => item.email === CHEF_EMAIL,
    )
    expect(chef, 'повар кухни — сотрудник управляющего рестораном').toBeTruthy()
    expect(chef).not.toHaveProperty('phone')
    expect(chef.messengers.telegram).toEqual({ linked: false, confirmed_at: null })
  })
})
