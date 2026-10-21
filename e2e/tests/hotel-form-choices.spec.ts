import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, HOTEL, PLATFORM } from './helpers'

/**
 * ВЫБОР ВМЕСТО ВВОДА В NaviRoom Control (партия 54).
 *
 * Пояс, валюта и языки вводились руками, поддомен проверялся только на
 * «не пусто», город правила группы был свободным текстом. Теперь — списки с
 * поиском из справочника сервера и проверка поддомена на ходу. Здесь —
 * то, что видит оператор; отказ самого сервера — `test_hotel_fields.py`.
 */

const ROOT_PORT = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5183').port || '5183'
const ROOT = `http://guest.localhost:${ROOT_PORT}`

async function openCreate(page: Page): Promise<void> {
  await page.goto(`${ROOT}/admin`)
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 30_000 })
  await page.goto(`${ROOT}/admin?section=fleet`)
  await page.getByTestId('admin-create-open').click()
  await expect(page.getByTestId('admin-create-name')).toBeVisible({ timeout: 15_000 })
}

test('пояс — из списка с поиском и смещением, валюта — ISO, языки — четыре', async ({ page }) => {
  await openCreate(page)

  // Пояс: поиск по части имени, подпись со смещением.
  const timezone = page.getByTestId('admin-create-timezone')
  await expect(timezone).toHaveValue('Europe/Moscow (UTC+3)')
  await timezone.click()
  await timezone.fill('vladivo')
  const vladivostok = page.getByRole('option', { name: 'Asia/Vladivostok (UTC+10)' })
  await expect(vladivostok).toBeVisible()
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1)
  await vladivostok.click()
  await expect(timezone).toHaveAttribute('data-value', 'Asia/Vladivostok')

  // Валюта: найти по коду, выбрать — в поле код и название.
  const currency = page.getByTestId('admin-create-currency')
  await currency.click()
  await currency.fill('jpy')
  await page.getByRole('listbox').locator('[role="option"][data-value="JPY"]').click()
  await expect(currency).toHaveAttribute('data-value', 'JPY')
  await expect(currency).toHaveValue(/^JPY — /)

  // Языки: в списке ровно поддерживаемые — набрать «de» нечем.
  await page.getByTestId('admin-create-languages').click()
  const offered = await page.getByRole('listbox').getByRole('option').evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-value')),
  )
  expect(offered.sort()).toEqual(['ar', 'en', 'ru', 'zh'])
  await page.keyboard.press('Escape')
})

test('поддомен проверяется на ходу: формат, запрет, занят, свободен', async ({ page }) => {
  await openCreate(page)
  const field = page.getByTestId('admin-create-subdomain')
  const status = page.getByTestId('admin-create-subdomain-status')
  await page.getByTestId('admin-create-name').fill('Проверка поддомена')
  await page.getByTestId('admin-create-admin-email').fill('owner@subcheck.test')

  const cases: Array<[string, string, RegExp]> = [
    ['ab', 'subdomain_format', /от 3 до 30|3 to 30/i],
    ['admin', 'subdomain_reserved', /занято платформой|reserved/i],
    [HOTEL, 'hotel_exists', /уже есть|already exists/i],
    [`free${Date.now().toString(36)}`, 'ok', /Свободен|Available/i],
  ]
  for (const [value, state, text] of cases) {
    await field.fill(value)
    await expect(field, `поддомен «${value}»`).toHaveAttribute('data-state', state, { timeout: 10_000 })
    await expect(status).toHaveText(text)
    if (state === 'ok') await expect(page.getByTestId('admin-create-submit')).toBeEnabled()
    else await expect(page.getByTestId('admin-create-submit')).toBeDisabled()
  }
})

test('email проверяется по форме — кнопка заперта, пока адрес неверный', async ({ page }) => {
  await openCreate(page)
  await page.getByTestId('admin-create-name').fill('Проверка почты')
  await page.getByTestId('admin-create-subdomain').fill(`mail${Date.now().toString(36)}`)
  await expect(page.getByTestId('admin-create-subdomain')).toHaveAttribute('data-state', 'ok', { timeout: 10_000 })

  const email = page.getByTestId('admin-create-admin-email')
  await email.fill('a@b')
  await email.blur()
  await expect(page.getByTestId('admin-create-dialog')).toContainText(/Неверный адрес|Invalid address/)
  await expect(page.getByTestId('admin-create-submit')).toBeDisabled()
  await email.fill('owner@mailcheck.test')
  await expect(page.getByTestId('admin-create-submit')).toBeEnabled()
})
