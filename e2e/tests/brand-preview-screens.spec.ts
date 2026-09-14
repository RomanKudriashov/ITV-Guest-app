import { expect, test, type FrameLocator, type Page } from '@playwright/test'

import { ADMIN, login } from './helpers'

/**
 * ПАРТИЯ 7, ЗАХОД 2: ПОКАЗ РИСУЕТ НАСТОЯЩИЕ ЭКРАНЫ НА НАСТОЯЩИХ ШИРИНАХ.
 *
 * УСЛОВИЯ ЗАДАЮТСЯ ЯВНО — режим темы, экран, ширина. В заходе 1 три проверки
 * упали именно потому, что полагались на состояние стенда: сравнивали со
 * светлым режимом, когда панель шла в тёмном, и переключали стиль на тот,
 * который уже стоял. Здесь экранов восемь и ширин четыре, и «как сейчас на
 * стенде» не годится тем более.
 */

async function openPreview(page: Page): Promise<void> {
  await login(page, ADMIN)
  await page.goto('/cms/brand')
  await expect(page.getByTestId('brand-preview')).toBeVisible({ timeout: 25_000 })
}

/** Содержимое рамки показа: у неё своё окно, и смотреть надо внутрь. */
function stage(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="brand-preview-stage-frame"]')
}

async function chooseScreen(page: Page, id: string): Promise<void> {
  await page.getByTestId('brand-preview-screen').click()
  await page.getByTestId(`brand-preview-screen-${id}`).click()
}

test.describe('Показ: настоящие экраны', () => {
  test('главная рисуется целиком, а не верхней третью', async ({ page }) => {
    await openPreview(page)
    await chooseScreen(page, 'home')

    const frame = stage(page)
    /*
      ПЛИТКИ ЗАВЕДЕНИЙ — ТО, ЧЕГО В ПОКАЗЕ НЕ БЫЛО ВООБЩЕ. Именно их настраивает
      соседняя вкладка, и именно их оператор не видел. Если они есть, значит
      рисуется настоящая главная, а не четыре выбранных руками компонента.
    */
    await expect(frame.getByTestId('guest-home'), 'в показе не настоящая главная').toBeVisible({
      timeout: 25_000,
    })
    await expect(frame.getByTestId('guest-home-bento')).toBeVisible()
  })

  test('переключение экрана открывает другой адрес витрины', async ({ page }) => {
    await openPreview(page)

    await chooseScreen(page, 'entry')
    await expect(
      stage(page).getByTestId('guest-room-input'),
      'экран входа не открылся',
    ).toBeVisible({ timeout: 25_000 })

    await chooseScreen(page, 'catalog')
    await expect(
      stage(page).getByTestId('guest-venue'),
      'меню заведения не открылось',
    ).toBeVisible({ timeout: 25_000 })
  })

  test('в показе нет ни одной выдуманной позиции', async ({ page }) => {
    await openPreview(page)
    await chooseScreen(page, 'catalog')
    const frame = stage(page)
    await expect(frame.getByTestId('guest-venue')).toBeVisible({ timeout: 25_000 })

    // Те самые три константы, которые жили в собранном руками показе.
    for (const invented of ['Ribeye Steak', 'Caesar Salad', 'Vanilla Pavlova']) {
      await expect(
        frame.locator('body'),
        `в показе снова выдуманное блюдо «${invented}»`,
      ).not.toContainText(invented)
    }
  })
})

test.describe('Показ: настоящие ширины', () => {
  test('на телефоне оболочка телефонная, на компьютере — десктопная', async ({ page }) => {
    await openPreview(page)
    await chooseScreen(page, 'home')

    /*
      ПОРОГ — 1024 ПИКСЕЛЯ, И ОН ТЕПЕРЬ ПЕРЕСЕКАЕТСЯ. Телефон 390 и планшет
      820 ниже порога: у гостя там нет верхней строки. Компьютер 1280 выше —
      строка обязана появиться. До этой партии колонка показа была 440, и
      десктопная оболочка не показывалась НИКОГДА.
    */
    await page.getByTestId('brand-preview-device-phone').click()
    await expect(stage(page).getByTestId('guest-topbar')).toHaveCount(0)

    await page.getByTestId('brand-preview-device-tablet').click()
    await expect(
      stage(page).getByTestId('guest-topbar'),
      'портретный планшет 820 — ниже порога, строки быть не должно',
    ).toHaveCount(0)

    await page.getByTestId('brand-preview-device-desktop').click()
    await expect(
      stage(page).getByTestId('guest-topbar'),
      'на компьютере не появилась десктопная оболочка',
    ).toBeVisible({ timeout: 15_000 })
  })

  test('телевизор больше не заблокирован', async ({ page }) => {
    await openPreview(page)
    const tv = page.getByTestId('brand-preview-device-tv')
    await expect(tv).toBeEnabled()
    await tv.click()
    await expect(stage(page).getByTestId('guest-topbar')).toBeVisible({ timeout: 15_000 })
  })

  test('«развернуть» показывает экран в натуральную величину', async ({ page }) => {
    await openPreview(page)
    await page.getByTestId('brand-preview-device-desktop').click()
    await page.getByTestId('brand-preview-full').click()

    const dialog = page.getByTestId('brand-preview-dialog')
    await expect(dialog).toBeVisible()
    // Внутри окна рамка остаётся 1280 своих пикселей — это и есть «настоящая
    // ширина»; на экране она лишь ужимается, если окно оператора меньше.
    await expect(dialog).toContainText('1280')
    await page.getByTestId('brand-preview-full-close').click()
  })
})

test.describe('Показ на обеих вкладках', () => {
  test('у «Витрины» есть свой показ', async ({ page }) => {
    await openPreview(page)
    await page.getByTestId('brand-tab-showcase').click()

    await expect(
      page.getByTestId('brand-preview'),
      'на вкладке «Витрина» показа нет — а настраивает она именно главную',
    ).toBeVisible({ timeout: 20_000 })
    await expect(stage(page).getByTestId('guest-home')).toBeVisible({ timeout: 25_000 })
  })
})
