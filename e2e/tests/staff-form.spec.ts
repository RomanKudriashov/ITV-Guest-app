import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken, signInToCms, unique } from './helpers'

/**
 * ОКНО НОВОГО СОТРУДНИКА — ФОРМА (партия 30, п.41, аудит ADM-004).
 *
 * Поля и кнопка жили без <form>: Enter не отправлял, менеджер паролей не
 * предлагал сохранить, Chromium писал «Password field is not contained in a
 * form». Теперь Enter отправляет, короткий пароль по-прежнему не пускает, и
 * предупреждения нет. Созданный сотрудник удаляется.
 */

test('Enter отправляет форму сотрудника, короткий пароль не пускает', async ({ page, request }) => {
  test.setTimeout(90_000)
  const warnings: string[] = []
  page.on('console', (message) => warnings.push(message.text()))
  const email = `${unique('form')}@crystal.local`
  await signInToCms(page, ADMIN)
  await page.goto('/cms/staff')
  await page.getByTestId('staff-add').first().click()
  const dialog = page.getByTestId('staff-dialog')
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate((el) => !!el.querySelector('input[type="password"]')?.closest('form'))).toBe(true)

  await page.getByTestId('staff-email').fill(email)
  await page.getByTestId('staff-full-name').fill('Проверка формы')
  await page.getByTestId('staff-password').fill('123')
  await page.getByTestId('staff-password').press('Enter')
  await page.waitForTimeout(800)
  await expect(dialog, 'короткий пароль: окно не отправилось').toBeVisible()

  await page.getByTestId('staff-password').fill('form-pass-12345')
  await page.getByTestId('staff-password').press('Enter')
  await expect(dialog, 'Enter отправил форму').toBeHidden({ timeout: 15_000 })

  const headers = apiHeaders(await apiToken(request, ADMIN))
  const staff = (await (await request.get(`${API}/api/cms/staff?limit=200&search=${email}`, { headers })).json()).items as Array<{
    id: string
    email: string
  }>
  const created = staff.find((member) => member.email === email)
  expect(created, 'сотрудник создан').toBeTruthy()
  await request.delete(`${API}/api/cms/staff/${created!.id}`, { headers })
  expect(warnings.filter((text) => /not contained in a form/i.test(text))).toEqual([])
})
