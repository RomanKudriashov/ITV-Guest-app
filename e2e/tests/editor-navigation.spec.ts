import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken, signIn } from './helpers'

/**
 * ПЕРЕХОД ИЗ РЕДАКТОРА ПО МЕНЮ — жалоба клиента (пункт 35 разбора).
 *
 * Выглядело так: в редакторе позиции клик по разделу в сайдбаре менял АДРЕС,
 * а экран оставался прежним. Ни перехода, ни вопроса — приложение просто
 * застревало, и починить это человек мог только перезагрузкой.
 *
 * Причина оказалась не в защите от потери правок, как думалось: объект
 * черновика (`useFormDraft`) пересоздавался на каждом рендере, эффект
 * гидратации держал его в зависимостях и выставлял baseline — рендер →
 * эффект → состояние → рендер. React упирался в «Maximum update depth
 * exceeded» и переставал перерисовывать дерево. Сайдбар был ни при чём.
 *
 * Здесь два укуса на обе половины правила:
 *   * ничего не правили — переход происходит молча;
 *   * есть несохранённое — переход СПРАШИВАЕТ. Застрявший экран без вопроса
 *     хуже любого из двух исходов.
 */
async function openFirstItem(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  const token = await apiToken(request)
  const categories = await (
    await request.get(`${API}/api/cms/categories`, { headers: apiHeaders(token) })
  ).json()
  const category = (categories.items ?? categories)[0]
  const items = await (
    await request.get(`${API}/api/cms/items?category_id=${category.id}`, {
      headers: apiHeaders(token),
    })
  ).json()
  const item = (items.items ?? items)[0]

  await signIn(page, ADMIN)
  await page.goto(`/cms/menu/items/${item.id}`)
  await expect(page.getByTestId('item-price-input')).toBeVisible({ timeout: 25_000 })
  return item
}

test('из редактора позиции переход по сайдбару меняет ЭКРАН, а не только адрес', async ({
  page,
  request,
}) => {
  const loops: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Maximum update depth')) {
      loops.push(message.text())
    }
  })

  await openFirstItem(page, request)
  await page.getByTestId('cms-nav-reviews').click()

  // Экран сменился: заголовок раздела на месте, редактора больше нет.
  await expect(page.getByTestId('cms-page-title')).toHaveText('Отзывы', { timeout: 25_000 })
  await expect(page.getByTestId('item-price-input')).toHaveCount(0)

  // И заодно сторожим саму причину: цикл обновлений в редакторе.
  expect(loops, `редактор зациклился:\n${loops.join('\n')}`).toEqual([])
})

test('несохранённое не теряется молча: переход спрашивает', async ({ page, request }) => {
  await openFirstItem(page, request)

  await page.getByTestId('cms-item-prep-minutes').fill('42')
  await expect(page.getByTestId('item-dirty-badge')).toBeVisible({ timeout: 15_000 })

  await page.getByTestId('cms-nav-reviews').click()

  const dialog = page.getByRole('dialog')
  await expect(dialog, 'переход не спросил про несохранённое').toBeVisible({ timeout: 15_000 })
  await expect(dialog).toContainText('Выйти без сохранения?')
  // Пока вопрос не отвечен, мы остаёмся на месте — адрес не уезжает вперёд.
  expect(page.url()).toContain('/menu/items/')

  // «Остаться» возвращает к правке, ничего не потеряв.
  await dialog.getByRole('button', { name: 'Остаться' }).click()
  await expect(page.getByTestId('cms-item-prep-minutes')).toHaveValue('42')
})

test('из редактора категории переход тоже работает', async ({ page, request }) => {
  const token = await apiToken(request)
  const categories = await (
    await request.get(`${API}/api/cms/categories`, { headers: apiHeaders(token) })
  ).json()
  const category = (categories.items ?? categories)[0]

  await signIn(page, ADMIN)
  await page.goto(`/cms/menu/categories/${category.id}`)
  await page.getByTestId('cms-nav-analytics').click()
  await expect(page.getByTestId('cms-page-title')).toHaveText('Аналитика', { timeout: 25_000 })
})
