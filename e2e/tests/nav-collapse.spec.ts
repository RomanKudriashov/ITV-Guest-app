import type { Locator, Page } from '@playwright/test'

import { expect, test } from './fixtures'
import { signIn, signInPlatform } from './helpers'

/**
 * СВЁРНУТОЕ МЕНЮ — ВЫБОР ЧЕЛОВЕКА, А НЕ СОСТОЯНИЕ ЭКРАНА (партия 55).
 *
 * Левое меню CMS и NaviRoom Control сворачивается до иконок (~64 px), подписи
 * уходят в подсказки. Проверяем три обещания:
 *   * выбор переживает перезагрузку (ключ `itv.cms.nav-collapsed` /
 *     `itv.platform.nav-collapsed`), а «развернуть» его снимает;
 *   * в свёрнутом виде подпись не пропала — она в подсказке при наведении;
 *   * шторка на телефоне ВСЕГДА полная, даже когда сохранено «свёрнуто»:
 *     иконки без подписей под пальцем — угадайка.
 *
 * Каждая проверка — в своём контексте браузера: хранилище чистое, меню по
 * умолчанию развёрнуто. На стенде ничего не пишется.
 */

const WIDE = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }

const width = async (locator: Locator): Promise<number> =>
  (await locator.boundingBox())?.width ?? 0

/** Ширина дотягивается анимацией — ждём итог, а не первый кадр. */
async function expectWidth(locator: Locator, min: number, max: number, what: string) {
  await expect
    .poll(() => width(locator), { message: `${what}: ширина вне ${min}–${max}`, timeout: 5_000 })
    .toBeGreaterThanOrEqual(min)
  await expect.poll(() => width(locator), { timeout: 5_000 }).toBeLessThanOrEqual(max)
}

async function openCms(page: Page) {
  await page.goto('/cms/dashboard')
  await expect(page.getByTestId('cms-nav-services')).toBeVisible({ timeout: 20_000 })
}

test.describe('Сворачивание меню', () => {
  test('CMS: свёрнуто переживает перезагрузку, подпись — в подсказке', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await signIn(page)
    await openCms(page)

    const paper = page.locator('[data-testid="main-nav-drawer"] .MuiDrawer-paper')
    // По умолчанию развёрнуто: подпись пункта видна.
    await expectWidth(paper, 240, 256, 'развёрнутое меню CMS')
    await expect(page.getByTestId('cms-nav-services')).toContainText('Сервисы')

    await page.getByTestId('nav-collapse').click()
    await expectWidth(paper, 56, 72, 'свёрнутое меню CMS')

    await page.reload()
    await expect(page.getByTestId('cms-nav-services')).toBeVisible({ timeout: 20_000 })
    await expectWidth(paper, 56, 72, 'свёрнутое меню CMS после перезагрузки')
    // Содержимое сдвинулось вместе с панелью, а не осталось под ней.
    const main = await page.locator('main').boundingBox()
    expect(main?.x ?? 0, 'содержимое не сдвинулось за свёрнутой панелью').toBeLessThan(100)

    // Текст пункта в DOM остаётся (его читают другие проверки), на экране — подсказка.
    expect((await page.getByTestId('cms-nav-services').innerText()).trim()).toBe('Сервисы')
    await page.getByTestId('cms-nav-services').hover()
    await expect(page.getByRole('tooltip')).toHaveText('Сервисы')

    await page.getByTestId('nav-collapse').click()
    await expectWidth(paper, 240, 256, 'развёрнутое меню CMS после «развернуть»')
    await page.reload()
    await expect(page.getByTestId('cms-nav-services')).toBeVisible({ timeout: 20_000 })
    await expectWidth(paper, 240, 256, 'развёрнутое меню CMS после перезагрузки')
  })

  test('CMS: на 390 шторка полная даже при сохранённом «свёрнуто»', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await signIn(page)
    await openCms(page)
    await page.getByTestId('nav-collapse').click()
    await expectWidth(
      page.locator('[data-testid="main-nav-drawer"] .MuiDrawer-paper'),
      56,
      72,
      'свёрнутое меню CMS',
    )

    await page.setViewportSize(PHONE)
    await page.reload()
    await page.getByTestId('nav-toggle').click()
    const nav = page.getByTestId('main-nav')
    await expect(nav).toBeVisible()
    await expectWidth(nav, 230, 256, 'шторка CMS на 390')
    await expect(page.getByTestId('cms-nav-services')).toBeVisible()
    // Подпись на экране, а не в подсказке: ширина текста больше нуля.
    const label = page.getByTestId('cms-nav-services').locator('.MuiListItemText-root')
    expect(await width(label), 'подпись пункта в шторке скрыта').toBeGreaterThan(30)
    // Кнопки сворачивания в шторке нет.
    await expect(page.getByTestId('nav-collapse')).toHaveCount(0)
  })

  test('Control: свёрнуто переживает перезагрузку, подпись — в подсказке', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await signInPlatform(page)
    await page.goto('/admin')
    const aside = page.getByTestId('admin-nav')
    await expect(aside).toBeVisible({ timeout: 20_000 })
    await expectWidth(aside, 240, 256, 'развёрнутое меню Control')

    await page.getByTestId('admin-nav-collapse').click()
    await expectWidth(aside, 56, 72, 'свёрнутое меню Control')

    await page.reload()
    await expect(aside).toBeVisible({ timeout: 20_000 })
    await expectWidth(aside, 56, 72, 'свёрнутое меню Control после перезагрузки')

    const fleet = aside.getByTestId('admin-nav-fleet')
    expect((await fleet.innerText()).trim()).toBe('Отели')
    await fleet.hover()
    await expect(page.getByRole('tooltip')).toHaveText('Отели')

    // Меню липкое: прокрутка страницы его не уносит.
    await page.mouse.wheel(0, 2000)
    await expect.poll(async () => (await aside.boundingBox())?.y ?? -1).toBe(0)

    await page.getByTestId('admin-nav-collapse').click()
    await expectWidth(aside, 240, 256, 'развёрнутое меню Control после «развернуть»')
    await page.reload()
    await expect(aside).toBeVisible({ timeout: 20_000 })
    await expectWidth(aside, 240, 256, 'развёрнутое меню Control после перезагрузки')
  })

  test('Control: на 390 шторка полная даже при сохранённом «свёрнуто»', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await signInPlatform(page)
    await page.goto('/admin')
    const aside = page.getByTestId('admin-nav')
    await expect(aside).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('admin-nav-collapse').click()
    await expectWidth(aside, 56, 72, 'свёрнутое меню Control')

    await page.setViewportSize(PHONE)
    await page.reload()
    await page.getByTestId('admin-nav-toggle').click()
    const drawer = page.getByTestId('admin-nav-drawer')
    await expect(drawer).toBeVisible()
    await expectWidth(drawer, 230, 256, 'шторка Control на 390')
    const fleet = drawer.getByTestId('admin-nav-fleet')
    await expect(fleet).toBeVisible()
    expect(await width(fleet.getByText('Отели')), 'подпись пункта в шторке скрыта').toBeGreaterThan(
      20,
    )
  })
})
