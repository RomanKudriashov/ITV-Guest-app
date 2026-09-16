import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, CREDENTIALS, signIn as openSession } from './helpers'

/**
 * ТРЕКЕР ЖИВЁТ В ОБЩЕЙ ОБОЛОЧКЕ.
 *
 * Он был отдельной веткой маршрутов со своей шапкой: клик по пункту «Трекер»
 * уводил ИЗ оболочки, и пунктов меню на экране становилось НОЛЬ — замер
 * показывал 12 → 0. Дальше кликать было не по чему, и это читалось как
 * «переход по меню не работает».
 *
 * Вторая половина — честность для того, у кого разделов нет. Повару
 * `/cms/navigation` отвечает 403, и рисовать ему пустую панель нельзя: пустой
 * ящик читается как «не догрузилось». Панели нет вовсе, а её отсутствие
 * СКАЗАНО строкой.
 */

async function signIn(
  page: Page,
  credentials: { email: string; password: string } = ADMIN,
) {
  /*
    Вход — готовой сессией: форма проверяется отдельными проверками
    (`cms-access`, `session-refresh`, `platform-console`), а здесь она была лишь
    дорогой к экрану.

    УЧЁТКА — ПАРАМЕТРОМ, и это не мелочь: половина проверок в этом файле про
    ПОВАРА, у которого панели нет. Войдя админом, они смотрели бы на чужой
    экран и зеленели бы на чём угодно.
  */
  await openSession(page, credentials)
  await page.goto('/tracker')
  await expect(page.getByTestId('tracker-board')).toBeVisible({ timeout: 20_000 })
}

test.describe('Каркас трекера', () => {
  test('админ: трекер открывается в оболочке, меню на месте и уводит обратно', async ({
    page,
  }) => {
    await signIn(page, ADMIN)
    // Ждём САМ пункт, а не считаем сразу: список разделов приезжает запросом,
    // и мгновенный счётчик поймал бы пустую панель на полпути.
    await expect(page.getByTestId('cms-nav-tracker')).toBeVisible({ timeout: 25_000 })
    const before = await page.locator('[data-testid^="cms-nav-"]').count()
    expect(before, 'в панели нет пунктов — проверять нечего').toBeGreaterThan(5)

    await page.getByTestId('cms-nav-tracker').click()
    await expect(page).toHaveURL(/\/tracker$/)

    // ГЛАВНОЕ: меню НЕ исчезло. Именно его исчезновение и читалось как
    // «переход не работает» — уйти дальше было нечем.
    await expect(page.getByTestId('tracker-screen')).toBeVisible({ timeout: 20_000 })
    const after = await page.locator('[data-testid^="cms-nav-"]').count()
    expect(after, `в трекере пунктов меню ${after}, было ${before}`).toBe(before)

    // Заголовок раздела — тот же, что пункт меню, как у всех разделов.
    await expect(page.getByTestId('cms-page-title')).toHaveText(
      (await page.getByTestId('cms-nav-tracker').innerText()).trim(),
    )

    // И обратно уходим тем же меню, а не единственной кнопкой.
    await page.getByTestId('cms-nav-services').click()
    await expect(page).toHaveURL(/\/services$/)
    await expect(page.getByTestId('cms-page-title')).toHaveText('Сервисы')
  })

  test('второй шапки на экране нет: выход один, и он в меню профиля', async ({ page }) => {
    // ПОВАР, а не админ: доска есть у того, кто привязан к заведению, и
    // переключатель точки — инструмент доски. У админа отеля привязки нет, и
    // он видит экран «вас ещё не назначили», где проверять инструменты нечего.
    await signIn(page, CREDENTIALS)
    await page.goto('/tracker')
    await expect(page.getByTestId('tracker-screen')).toBeVisible({ timeout: 25_000 })

    // Инструменты доски остались при доске.
    await expect(page.getByTestId('tracker-point-select')).toBeVisible()
    await expect(page.getByTestId('tracker-sound-toggle')).toBeVisible()

    // А приложенческое — только в общей шапке, по одному экземпляру: две
    // кнопки выхода на одном экране были ровно тем, что давала вторая шапка.
    await expect(page.getByTestId('tracker-logout')).toHaveCount(0)
    await expect(page.getByTestId('tracker-to-cms')).toHaveCount(0)
    await expect(page.getByTestId('hotel-name')).toHaveCount(1)
  })

  test('повар: трекер в оболочке, панели НЕТ, и об этом сказано', async ({ page }) => {
    await signIn(page, CREDENTIALS)
    await page.goto('/tracker')
    await expect(page.getByTestId('tracker-screen')).toBeVisible({ timeout: 25_000 })

    // Пустой панели не рисуем — ни ящика, ни кнопки-гамбургера.
    await expect(page.locator('[data-testid^="cms-nav-"]')).toHaveCount(0)
    await expect(page.getByTestId('nav-toggle')).toHaveCount(0)
    // Но отсутствие разделов СКАЗАНО, а не оставлено догадкой.
    await expect(page.getByTestId('cms-no-sections')).toBeVisible()
    // И это не экран отказа: доска повара на месте.
    await expect(page.getByTestId('cms-no-access')).toHaveCount(0)
  })


  test('узкий экран: у повара нет панели, но объяснение ВИДНО', async ({ page }) => {
    /*
      Строка стояла в шапке и пряталась на узком (`display: xs none`) — там
      тесно. Получалось худшее из двух: панели нет и объяснения тоже нет, то
      есть ровно та пустота без причины, от которой строка и заводилась.
    */
    await signIn(page, CREDENTIALS)
    for (const [width, height] of [
      [390, 844],
      [834, 1112],
      [1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height })
      await page.goto('/tracker')
      await expect(page.getByTestId('tracker-screen')).toBeVisible({ timeout: 25_000 })

      await expect(page.locator('[data-testid^="cms-nav-"]')).toHaveCount(0)
      await expect(page.getByTestId('nav-toggle')).toHaveCount(0)
      await expect(
        page.getByTestId('cms-no-sections'),
        `на ${width}px панели нет и объяснения тоже`,
      ).toBeVisible()
    }
  })

  test('узкий экран: вкладки аккуратные, счётчик колонки читается, ничего не уехало', async ({
    page,
  }) => {
    await signIn(page, CREDENTIALS)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/tracker')
    await expect(page.getByTestId('tracker-screen')).toBeVisible({ timeout: 25_000 })
    /*
      ЖДЁМ ЛЕНТУ КОЛОНОК, А НЕ СЕКУНДУ С ЧЕТВЕРТЬЮ.

      Здесь стояло `waitForTimeout(1200)` — и проверка краснела на исправном
      экране, как только стенд подрос: доска из полутора сотен карточек
      собирается на сервере 1,2 секунды, и к исходу паузы лента ещё не
      отрисована (замерено: на 1200 мс вкладок 0, на 3200 мс — четыре).
      Фиксированная пауза меряет не продукт, а скорость машины.
    */
    await expect(page.locator('[data-testid^="tracker-tab-"]').first()).toBeVisible({
      timeout: 25_000,
    })

    // Страница не разъехалась вбок.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
      'на 390px появилась горизонтальная прокрутка страницы',
    ).toBe(true)

    /*
      Вкладки «В работе»/«История» — ОБЫЧНЫЕ, а не плашки во весь экран. Раньше
      стоял `variant="fullWidth"`, и каждая занимала половину ширины.
    */
    const scope = (await page.getByTestId('tracker-active-tab').boundingBox())!
    expect(
      scope.width,
      `вкладка «В работе» шириной ${Math.round(scope.width)}px — это снова плашка`,
    ).toBeLessThan(195)

    // Лента колонок вкладками, и счётчик в каждой читается.
    const tabs = page.locator('[data-testid^="tracker-tab-"]')
    expect(await tabs.count(), 'ленты колонок нет').toBeGreaterThan(1)
    const first = (await tabs.first().innerText()).replace(/\s+/g, ' ').trim()
    expect(first, `в вкладке колонки не видно счётчика: "${first}"`).toMatch(/\S+\s+\d+/)
  })

  test('повар в панели по-прежнему получает отказ, а не пустую оболочку', async ({ page }) => {
    await signIn(page, CREDENTIALS)
    await page.goto('/cms/dashboard')
    await expect(page.getByTestId('cms-no-access')).toBeVisible({ timeout: 25_000 })
  })
})
