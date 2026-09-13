import { expect, test } from '@playwright/test'

import { PLATFORM } from './helpers'

const ROOT = 'http://localhost:5183'

/**
 * САЙДБАР ПЛАТФОРМЕННОЙ КОНСОЛИ — ТРЕТИЙ, И ОН ОТЛИЧАЕТСЯ ОТ ДВУХ ДРУГИХ.
 *
 * Раздел консоли держится не в маршруте, а в `?section=`, и переключался он
 * через `setSearchParams(..., { replace: true })`. Экран при этом менялся
 * исправно — и именно поэтому поломку не видел никто: она не в переходе, а в
 * том, что от перехода НЕ ОСТАВАЛОСЬ СЛЕДА.
 *
 * Замер до починки: три переключения давали `history.length` 2 → 2, а первая
 * же «назад» уводила на `about:blank` — то есть кнопка браузера выбрасывала
 * оператора из консоли вместо возврата в прежний раздел.
 *
 * Вторая половина той же поломки: пункты были `<button>` без `href`. Адрес
 * раздела при этом рабочий (`/admin?section=team` в чистой вкладке открывает
 * «Пользователей») — то есть ссылка существовала, а открыть её в новой вкладке
 * было нечем.
 */

async function loginToConsole(page: import('@playwright/test').Page) {
  await page.goto(`${ROOT}/admin`)
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-crumb')).toBeVisible({ timeout: 20_000 })
}

const crumb = (page: import('@playwright/test').Page) =>
  page.getByTestId('admin-crumb').innerText().then((t) => t.trim())

test.describe('Консоль: сайдбар', () => {
  test('клик по пункту меняет ЭКРАН, а не только адрес', async ({ page }) => {
    await loginToConsole(page)
    const expected: Record<string, string> = {
      fleet: 'Отели',
      groups: 'Группы',
      team: 'Пользователи',
      audit: 'Аудит',
      nodes: 'On-premise',
      overview: 'Сводка',
    }
    for (const [key, title] of Object.entries(expected)) {
      await page.getByTestId(`admin-nav-${key}`).click()
      await expect(page).toHaveURL(new RegExp(`section=${key}`))
      await expect(page.getByTestId('admin-crumb')).toHaveText(title)
    }
  })

  test('«назад» браузера возвращает в прежний раздел, а не выбрасывает из консоли', async ({
    page,
  }) => {
    await loginToConsole(page)
    await page.getByTestId('admin-nav-fleet').click()
    await expect(page.getByTestId('admin-crumb')).toHaveText('Отели')
    await page.getByTestId('admin-nav-team').click()
    await expect(page.getByTestId('admin-crumb')).toHaveText('Пользователи')
    await page.getByTestId('admin-nav-audit').click()
    await expect(page.getByTestId('admin-crumb')).toHaveText('Аудит')

    // Каждое переключение — шаг истории. Проверяется РЕЗУЛЬТАТ шага, а не
    // счётчик: счётчик молчал бы о том, куда именно вернуло.
    await page.goBack()
    await expect(page.getByTestId('admin-crumb'), 'назад не вернуло в «Пользователей»').toHaveText(
      'Пользователи',
    )
    await page.goBack()
    await expect(page.getByTestId('admin-crumb'), 'назад не вернуло в «Отели»').toHaveText('Отели')

    // И консоль всё ещё на месте: из приложения нас не вынесло.
    await expect(page.getByTestId('admin-shell')).toBeVisible()
  })


  test('фильтр списка переживает открытие карточки и «назад»', async ({ page }) => {
    /*
      Фильтры жили в состоянии компонента, а карточку отеля рисует ТОТ ЖЕ
      раздел (`section === 'fleet' && !hotelId`) — открывая её, список
      размонтируется вместе со своим состоянием. Замер до правки: фильтр
      «crystal» давал одну строку, после возврата поле пустое — и кнопкой, и
      «назад».
    */
    await loginToConsole(page)
    await page.getByTestId('admin-nav-fleet').click()
    await expect(page.getByTestId('admin-fleet')).toBeVisible({ timeout: 20_000 })

    await page.getByTestId('admin-fleet-search').fill('crystal')
    await expect(page).toHaveURL(/search=crystal/, { timeout: 10_000 })
    await expect(page.getByTestId('admin-fleet-open-crystal')).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('admin-fleet-open-crystal').click()
    await expect(page).toHaveURL(/hotel=/, { timeout: 15_000 })

    await page.goBack()
    await expect(page.getByTestId('admin-fleet')).toBeVisible({ timeout: 20_000 })
    await expect(
      page.getByTestId('admin-fleet-search'),
      'после возврата фильтр сброшен — список показывает не то, что человек оставил',
    ).toHaveValue('crystal')
  })

  test('набор в поле поиска НЕ засоряет историю', async ({ page }) => {
    /*
      Фильтр в адресе обязан заменять запись, а не добавлять: иначе «назад»
      после набранного «crystal» пришлось бы жать семь раз, по одному на букву,
      чтобы выйти из списка.
    */
    await loginToConsole(page)
    await page.getByTestId('admin-nav-fleet').click()
    await expect(page.getByTestId('admin-fleet')).toBeVisible({ timeout: 20_000 })

    const before = await page.evaluate(() => history.length)
    await page.getByTestId('admin-fleet-search').pressSequentially('crystal', { delay: 40 })
    await expect(page).toHaveURL(/search=crystal/, { timeout: 10_000 })
    const after = await page.evaluate(() => history.length)
    expect(
      after - before,
      `семь букв добавили ${after - before} записей истории вместо нуля`,
    ).toBe(0)

    // И одним «назад» уходим из списка, а не разбираем набранное по буквам.
    await page.goBack()
    await expect(page.getByTestId('admin-crumb')).toHaveText('Сводка')
  })

  test('пункт — ссылка: раздел открывается в новой вкладке', async ({ page, context }) => {
    await loginToConsole(page)

    // У пункта есть настоящий `href` — без него ни средний клик, ни Cmd+клик
    // браузеру нечего открыть.
    const href = await page.getByTestId('admin-nav-team').getAttribute('href')
    expect(href, 'у пункта меню нет href — в новой вкладке не открыть').toBe('?section=team')

    const opened = context.waitForEvent('page')
    await page.getByTestId('admin-nav-audit').click({ modifiers: ['Meta'] })
    const tab = await opened
    await tab.waitForLoadState('domcontentloaded')
    await expect(tab).toHaveURL(/section=audit/)
    await expect(tab.getByTestId('admin-crumb')).toHaveText('Аудит', { timeout: 20_000 })
    await tab.close()

    // Исходная вкладка осталась там, где была: Cmd+клик не уводит её.
    await expect(page.getByTestId('admin-crumb')).toHaveText('Сводка')
  })
})
