import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken, signIn } from './helpers'

/**
 * ОТЗЫВЫ НА ПУЛЬТЕ (пункт 30 разбора).
 *
 * Было: одна средняя оценка. Средняя молчит ровно о том, что требует
 * действия — на стенде она показывала 4,05 при двадцати шести отзывах,
 * ждущих ответа, и пульт об этом не говорил ни словом.
 *
 * Стало: карточка «требует внимания» с числом ждущих и блок последних низких
 * — сразу со ссылкой на сам отзыв.
 */
test('пульт показывает отзывы без ответа', async ({ page, request }) => {
  const token = await apiToken(request)
  const board = await (
    await request.get(`${API}/api/cms/dashboard`, { headers: apiHeaders(token) })
  ).json()
  const awaiting = board.reviews?.awaiting ?? 0
  test.skip(awaiting === 0, 'на стенде нет отзывов без ответа — проверять нечего')

  await signIn(page, ADMIN)
  await page.goto('/cms/dashboard')
  await expect(page.getByTestId('cms-page-title')).toBeVisible({ timeout: 25_000 })

  // Карточка «требует внимания» — число ждущих и чем это грозит.
  const card = page.getByTestId('dashboard-attention-reviews_awaiting')
  await expect(card, 'на пульте нет карточки про отзывы без ответа').toBeVisible({
    timeout: 25_000,
  })
  await expect(card).toContainText(String(awaiting))

  // И блок с самими отзывами — если низкие среди них есть.
  if ((board.reviews?.items ?? []).length) {
    const block = page.getByTestId('dashboard-reviews')
    await expect(block).toBeVisible()
    const first = board.reviews.items[0]
    await expect(page.getByTestId(`dashboard-review-${first.id}`)).toBeVisible()
    // Оценка видна цифрой: «1 из 5» читается без наведения.
    await expect(page.getByTestId(`dashboard-review-rating-${first.id}`)).toContainText(
      String(first.rating),
    )
  }
})

test('блок отзывов ведёт в раздел разбора', async ({ page, request }) => {
  const token = await apiToken(request)
  const board = await (
    await request.get(`${API}/api/cms/dashboard`, { headers: apiHeaders(token) })
  ).json()
  const first = (board.reviews?.items ?? [])[0]
  test.skip(!first, 'нет низких отзывов без ответа')

  await signIn(page, ADMIN)
  await page.goto('/cms/dashboard')
  await page.getByTestId(`dashboard-review-${first.id}`).click()
  await expect(page).toHaveURL(/\/reviews/, { timeout: 25_000 })
})
