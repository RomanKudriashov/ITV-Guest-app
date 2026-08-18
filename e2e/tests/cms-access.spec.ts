import { expect, test, type Page } from '@playwright/test'

import { BARMAN, CONCIERGE, CREDENTIALS, MAID, RESTAURANT_MANAGER } from './helpers'

/**
 * Отказ по правам — это отказ, а не тупик.
 *
 * Что было: повар открывает /cms/services и видит оболочку CMS с кнопкой
 * «Добавить сервис», «Не удалось загрузить заведения · Повторить» и ПУСТУЮ
 * боковую панель. Отказ по роли показан как сбой загрузки, «Повторить»
 * предлагает то, что не сработает никогда, а уйти отсюда некуда.
 *
 * Почему это не ловилось: проверка на роль была, но смотрела в API —
 * «403 и код no_cms_access». Сервер и правда отказывал верно. Никто не смотрел
 * на ЭКРАН, а сломан был именно он.
 *
 * Здесь проверяется экран, и по всем разделам сразу: тупик в одном из них
 * ничем не лучше тупика во всех.
 */

const SECTIONS = [
  '/cms/services',
  '/cms/rooms',
  '/cms/staff',
  '/cms/brand',
  '/cms/analytics',
  '/cms/settings',
  '/cms/dictionaries',
  '/cms/dashboard',
]

async function loginAs(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(who.email)
  await page.getByTestId('login-password').fill(who.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

for (const { role, who } of [
  { role: 'повар', who: CREDENTIALS },
  { role: 'горничная', who: MAID },
  { role: 'бармен', who: BARMAN },
  { role: 'консьерж', who: CONCIERGE },
]) {
  test(`${role}: на закрытом разделе CMS — отказ и путь наружу, а не тупик`, async ({ page }) => {
    await loginAs(page, who)

    for (const section of SECTIONS) {
      await page.goto(section)
      await expect(
        page.getByTestId('cms-no-access'),
        `${section}: вместо отказа по правам показано что-то другое`,
      ).toBeVisible({ timeout: 20_000 })
      await expect(
        page.getByTestId('no-access-to-tracker'),
        `${section}: отказ есть, а выхода нет — это тупик`,
      ).toBeVisible()
    }

    // Дорога наружу РАБОЧАЯ: ведёт на его место, а не просто куда-то.
    await page.goto('/cms/services')
    await page.getByTestId('no-access-to-tracker').click()
    await expect(page).toHaveURL(/\/tracker/, { timeout: 20_000 })
    await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })
  })
}

test('управляющий сервисом разделы видит — отказ его не касается', async ({ page }) => {
  await loginAs(page, RESTAURANT_MANAGER)

  for (const section of SECTIONS) {
    await page.goto(section)
    await expect(page.getByTestId('cms-no-access'), section).toHaveCount(0)
    await expect(page.getByTestId('main-nav'), section).toBeVisible({ timeout: 20_000 })
  }
})
