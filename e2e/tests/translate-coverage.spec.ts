import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken, signIn } from './helpers'

/**
 * Автоперевод без модели (пункт 32).
 *
 * Главная проверка — ЧЕСТНОСТЬ. Модель не подключена, и экран говорит об этом
 * прямо: кнопка не запускает пустой прогон, поля не заполняются похожим на
 * перевод текстом. Ничего не меняем на стенде — читаем.
 */
test('охват перевода считается, а кнопка честно говорит, что модели нет', async ({ page, request }) => {
  await signIn(page, ADMIN)
  await page.goto('/cms/settings')

  const section = page.getByTestId('settings-translate')
  await expect(section).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('cms-translate-not-connected')).toContainText(
    'Автоперевод пока не подключён',
  )

  // «Английский: 296 из 815» — числа настоящие, из данных отеля.
  const done = page.getByTestId('cms-translate-done-en')
  await expect(done).toContainText(/\d+ из \d+/)

  // Кнопка запуска есть, но нажать её нельзя, и подпись не обещает работу.
  const run = page.getByTestId('cms-translate-run-en')
  await expect(run).toBeDisabled()
  await expect(run).toContainText('Не подключён')

  // Сервер отвечает тем же словом, а не молча «успехом с нулём».
  const token = await apiToken(request)
  const refused = await request.post(`${API}/api/cms/translate/runs`, {
    headers: apiHeaders(token),
    data: { languages: ['en'] },
  })
  expect(refused.status()).toBe(409)
  expect((await refused.json()).code).toBe('translation_not_connected')
})

test('подробности охвата разложены по разделам витрины', async ({ page }) => {
  await signIn(page, ADMIN)
  await page.goto('/cms/settings')
  await expect(page.getByTestId('settings-translate')).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('cms-translate-details-en').click()
  await expect(page.getByTestId('cms-translate-coverage')).toContainText('позиции')
  await expect(page.getByTestId('cms-translate-coverage')).toContainText('разделы')
})
