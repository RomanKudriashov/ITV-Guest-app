import { expect, test } from './fixtures'

import { signIn } from './helpers'

/**
 * «ПОКАЗ» В БРЕНДЕ: ЗАВЕДЕНИЕ И ЯЗЫК (партия 58в).
 *
 * У Метрополя «Показ» открывал «Ресепшен» без меню — «No services yet» — и
 * смешивал языки: данные отеля приходили на языке браузера (`Accept-Language`),
 * а интерфейс показа — на языке панели. Теперь данные — на языке показа
 * (`?lang=`), заведение по умолчанию — первое с позициями, его можно выбрать.
 * Только чтение: показ не пишет ничего.
 */
test.use({ locale: 'en-US' })

test('панель на русском, браузер en-US — «Показ» целиком по-русски, заведение с меню', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('itv.lang', 'ru'))
  await signIn(page)
  await page.goto('/cms/brand')
  await expect(page.getByTestId('brand-preview')).toBeVisible({ timeout: 25_000 })

  await page.getByTestId('brand-preview-screen').click()
  await page.getByTestId('brand-preview-screen-catalog').click()
  const frame = page.frameLocator('[data-testid="brand-preview-stage-frame"]')
  // Заведение с меню: карточки позиций есть, пустого «Услуг пока нет» нет.
  await expect(frame.locator('[data-testid^="guest-item-"]').first()).toBeVisible({ timeout: 25_000 })
  const text = await frame.locator('body').innerText()
  expect(text, 'данные отеля в показе не на языке панели').not.toMatch(/Crystal Hotel|Lobby bar|Panorama/)
  expect(text).not.toMatch(/No services yet/)

  // Заведение выбирается; в списке видно, где меню пустое.
  const picker = page.getByTestId('brand-preview-venue')
  await expect(picker).toBeVisible()
  await picker.click()
  const options = page.locator('[data-testid^="brand-preview-venue-"]')
  expect(await options.count()).toBeGreaterThan(1)
  await options.last().click()
  await expect(frame.getByTestId('guest-venue-header')).toBeVisible({ timeout: 25_000 })

  // Экран «Заведения» — тот же ответ, что у гостя: рестораны есть.
  await page.getByTestId('brand-preview-screen').click()
  await page.getByTestId('brand-preview-screen-venues').click()
  await expect(frame.locator('[data-testid="guest-venue-list"] [data-testid^="guest-venue-"]').first()).toBeVisible({
    timeout: 25_000,
  })
})
