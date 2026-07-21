import { expect, test, type Page } from '@playwright/test'

import { apiToken, CREDENTIALS, guestTheme, HOTEL } from './helpers'

/**
 * Бренд-настройки с живым превью.
 *
 * Definition of Done прогона: сменил тему/пресет в CMS → сохранил → гостевая
 * витрина отражает изменение. Проверяем именно доезд до гостя, а не только
 * перекраску превью: редактор бренда бесполезен, если витрина его не видит.
 */

async function openBrand(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(CREDENTIALS.email)
  await page.getByTestId('login-password').fill(CREDENTIALS.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })

  await page.goto('/cms/brand')
  await expect(page.getByTestId('brand-editor')).toBeVisible({ timeout: 20_000 })
}

test.describe('Бренд-настройки', () => {
  // Тесты правят общую тему демо-отеля — гоняем по одному и восстанавливаем.
  test.afterEach(async ({ request }) => {
    const token = await apiToken(request)
    await request.post('http://localhost:8010/api/cms/brand/apply-preset', {
      data: { preset: 'evening_concierge' },
      headers: { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL },
    })
  })

  test('сменил пресет → сохранил → витрина отражает', async ({ page, request }) => {
    await openBrand(page)

    // Живое превью — реальные компоненты, не картинка.
    await expect(page.getByTestId('brand-preview')).toBeVisible()

    // Применяем пресет — превью должно перекраситься до сохранения.
    await page.getByTestId('brand-preset-azure_light').click()
    await expect(page.getByTestId('brand-dirty')).toBeVisible()

    await page.getByTestId('brand-save').click()
    await expect(page.getByTestId('brand-dirty')).toBeHidden({ timeout: 15_000 })

    // Гость видит сохранённый пресет.
    await expect
      .poll(async () => (await guestTheme(request)).preset)
      .toBe('azure_light')
  })

  test('правка акцента доезжает до гостя как custom', async ({ page, request }) => {
    await openBrand(page)

    const accent = page.getByTestId('brand-accent')
    await expect(accent).toBeVisible()
    // Пикер — input type=color; задаём значение и триггерим change.
    await accent.evaluate((el: HTMLInputElement) => {
      el.value = '#ff5722'
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect(page.getByTestId('brand-dirty')).toBeVisible()

    await page.getByTestId('brand-save').click()
    await expect(page.getByTestId('brand-dirty')).toBeHidden({ timeout: 15_000 })

    const theme = await guestTheme(request)
    // Ручная правка снимает ярлык пресета.
    expect(theme.preset).toBe('custom')
    expect(theme.palette.light.secondary.toLowerCase()).toBe('#ff5722')
  })

  test('превью показывает светлую/тёмную и RTL, не трогая CMS', async ({ page }) => {
    await openBrand(page)

    const preview = page.getByTestId('brand-preview')
    await expect(preview).toBeVisible()

    // Переключатели меняют только превью — сама CMS остаётся LTR и в своём режиме.
    await page.getByTestId('brand-preview-mode-toggle').click()
    await page.getByTestId('brand-preview-rtl-toggle').click()

    // Превью получило rtl-направление, а страница CMS — нет.
    await expect(preview.locator('[dir="rtl"]').first()).toBeVisible()
    await expect(page.locator('html')).not.toHaveAttribute('dir', 'rtl')
  })

  test('сброс возвращает к сохранённому', async ({ page }) => {
    await openBrand(page)

    await page.getByTestId('brand-preset-marble_linen').click()
    await expect(page.getByTestId('brand-dirty')).toBeVisible()

    await page.getByTestId('brand-reset').click()
    await expect(page.getByTestId('brand-dirty')).toBeHidden()
  })
})
