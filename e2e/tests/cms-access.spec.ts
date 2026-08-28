import { expect, test, type Page } from '@playwright/test'

import { ADMIN, apiToken, BARMAN, CONCIERGE, CREDENTIALS, HOTEL, MAID, RESTAURANT_MANAGER } from './helpers'

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

/* ── Посадка после входа ────────────────────────────────────────────────── */

for (const { role, who } of [
  { role: 'повар', who: CREDENTIALS },
  { role: 'горничная', who: MAID },
  { role: 'консьерж', who: CONCIERGE },
]) {
  test(`${role}: вход ведёт сразу на доску, без единого отказа по дороге`, async ({ page }) => {
    /*
      УКУС. Отказ по правам мы сделали аккуратно, а посадку не поправили: вход
      уводил ВСЕХ в `/dashboard`, и линейный сотрудник каждый раз проходил
      через запертую дверь, чтобы попасть к себе.

      Проверяем не только конечный адрес, но и что отказа НЕ БЫЛО ни разу:
      «дошёл, но через отказ» — это ровно то состояние, которое чинится.
    */
    const refusals: string[] = []
    page.on('framenavigated', () => {
      // Ловим сам факт появления экрана отказа в любой момент перехода.
    })

    await page.goto('/login')
    await page.getByTestId('login-email').fill(who.email)
    await page.getByTestId('login-password').fill(who.password)

    const seenRefusal = page
      .getByTestId('cms-no-access')
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => refusals.push('отказ CMS показывался после входа'))
      .catch(() => undefined)

    await page.getByTestId('login-submit').click()

    await expect(page).toHaveURL(/\/tracker/, { timeout: 20_000 })
    await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })

    await seenRefusal
    expect(refusals, refusals.join('; ')).toEqual([])

    // И на его рабочем месте нет двери, за которой отказ.
    await expect(page.getByTestId('tracker-to-cms')).toBeHidden()
  })
}

// Отдельными тестами, а не циклом внутри одного: после первого входа `/login`
// сразу уводит на посадку, поля там уже нет, и второй проход падал на вводе.
for (const { role, who } of [
  { role: 'управляющий сервисом', who: RESTAURANT_MANAGER },
  { role: 'админ отеля', who: ADMIN },
]) {
  test(`${role} после входа попадает в панель, как и раньше`, async ({ page }) => {
    // Правило решает по ПРАВУ, а не по названию роли: у обоих есть доступ в
    // CMS, значит посадка не меняется. Без этой проверки правка «повару доску»
    // могла бы увести на доску и тех, кому нужна панель.
    await page.goto('/login')
    await page.getByTestId('login-email').fill(who.email)
    await page.getByTestId('login-password').fill(who.password)
    await page.getByTestId('login-submit').click()
    await expect(page, `${who.email} уехал не в панель`).toHaveURL(/\/(cms|admin)\//, {
      timeout: 20_000,
    })
    await expect(page.getByTestId('cms-no-access')).toBeHidden()
  })
}

test('закладка в закрытый раздел не приводит повара к отказу', async ({ page }) => {
  // Своя закладка — второй путь в ту же дверь. `from` уважается, но не когда
  // ведёт туда, где откажут.
  await page.goto('/cms/services')
  await page.getByTestId('login-email').fill(CREDENTIALS.email)
  await page.getByTestId('login-password').fill(CREDENTIALS.password)
  await page.getByTestId('login-submit').click()

  await expect(page).toHaveURL(/\/tracker/, { timeout: 20_000 })
  await expect(page.getByTestId('cms-no-access')).toBeHidden()
})

test('сотрудник без единой привязки: понятный экран, а не пустая доска и не отказ', async ({
  page,
  request,
}) => {
  /*
    Такой человек существует: его завели и ещё не назначили. Ему нельзя ни в
    CMS (нет прав), ни на доску (нет точек) — и раньше вход вёл его в CMS,
    то есть в отказ, откуда кнопка вела на доску, где кнопка вела обратно в
    CMS. Петля между двумя отказами.

    Заводим и убираем за собой сами: постоянная учётка-«новичок» на общем
    стенде — это мусор, который потом никто не опознает.
  */
  const token = await apiToken(request)
  const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }
  const email = `newbie-${Date.now()}@crystal.local`

  const created = await request.post('http://localhost:8010/api/cms/staff', {
    headers,
    data: { email, full_name: 'Без привязки', password: 'chef12345', is_hotel_admin: false },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const userId = (await created.json()).id

  try {
    await page.goto('/login')
    await page.getByTestId('login-email').fill(email)
    await page.getByTestId('login-password').fill('chef12345')
    await page.getByTestId('login-submit').click()

    // Ведёт на его место, а не в закрытое.
    await expect(page).toHaveURL(/\/tracker/, { timeout: 20_000 })
    await expect(page.getByTestId('cms-no-access')).toBeHidden()

    // И объясняет, почему пусто, вместо пустой доски.
    await expect(page.getByTestId('tracker-no-points')).toBeVisible({ timeout: 20_000 })

    // Двери в закрытое отсюда нет — иначе это была бы та самая петля.
    await expect(page.getByTestId('tracker-to-cms')).toBeHidden()
  } finally {
    await request.delete(`http://localhost:8010/api/cms/staff/${userId}`, { headers })
  }
})
