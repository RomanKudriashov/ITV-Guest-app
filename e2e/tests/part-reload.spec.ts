import { expect, test } from './fixtures'

import { DEMO_ROOM } from './helpers'

/**
 * ЧАСТЬ СБОРКИ ИСЧЕЗЛА С СЕРВЕРА (партия 35, п.65).
 *
 * После выкатки у открытой вкладки старый `index` просит части прошлой
 * сборки, а nginx на них отвечает 404. Приложение перезапускает страницу ОДИН
 * раз (`frontend/src/app/lazyPart.tsx`): свежий `index.html` знает новые имена.
 * Второй раз подряд — уже не перезапуск, а понятная ошибка: иначе часть,
 * которой нет и в новой сборке, крутила бы страницу вечно.
 *
 * 404 подставляется на файл части гостя: в деве это модуль
 * `src/app/parts/guest.ts`, в прод-сборке — `assets/guest-<хэш>.js`.
 */
const GUEST_PART = /\/(src\/app\/parts\/guest\.ts|assets\/guest-[\w-]+\.js)(\?|$)/

test('часть пропала один раз — один тихий перезапуск, и главная гостя на месте', async ({ page }) => {
  let refused = 0
  await page.route(GUEST_PART, async (route) => {
    if (refused === 0) {
      refused += 1
      await route.fulfill({ status: 404, body: 'not found' })
      return
    }
    await route.continue()
  })
  let loads = 0
  page.on('load', () => {
    loads += 1
  })

  await page.goto(`/r/${DEMO_ROOM}`)
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 30_000 })
  expect(refused, 'часть гостя отказала один раз').toBe(1)
  expect(loads, 'страница загружалась дважды: заход и один перезапуск').toBe(2)
  await expect(page.getByTestId('part-failed')).toHaveCount(0)
})

test('часть не приходит и после перезапуска — ошибка с кнопкой, без петли', async ({ page }) => {
  let refused = 0
  await page.route(GUEST_PART, async (route) => {
    refused += 1
    await route.fulfill({ status: 404, body: 'not found' })
  })
  let loads = 0
  page.on('load', () => {
    loads += 1
  })

  await page.goto(`/r/${DEMO_ROOM}`)
  await expect(page.getByTestId('part-failed')).toBeVisible({ timeout: 30_000 })
  // Петля видна только во времени: ждём дольше, чем идёт перезапуск.
  await page.waitForTimeout(4_000)
  expect(loads, 'один заход и ровно один перезапуск').toBe(2)
  expect(refused, 'часть просили дважды — до и после перезапуска').toBe(2)
  await expect(page.getByTestId('part-failed')).toContainText('Не удалось загрузить экран')
})
