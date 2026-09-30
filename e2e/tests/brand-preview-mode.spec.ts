import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken, signInToCms } from './helpers'

/**
 * ПЕРЕКЛЮЧАТЕЛЬ «СВЕТЛАЯ / ТЁМНАЯ» МЕНЯЕТ САМ ПОКАЗ (бэклог 30, партия 24).
 *
 * Провайдер темы в кадре показа брал режим из `initialMode` один раз, при
 * монтировании: переключатель менял кнопку, а показ оставался в режиме, с
 * которым смонтировался кадр. Проверка цвета текста «плавала» ровно поэтому —
 * зелёная, если кадр успевал смонтироваться до того, как страница выставляла
 * тёмный режим бренда, красная — если после.
 *
 * Ожидаемые цвета читаются из бренда отеля через API — условие не зависит от
 * того, какая палитра у демо-отеля сегодня.
 */
function rgb(color: string): string {
  const hex = color.replace('#', '')
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

test('показ бренда переключается в обе стороны — фон рамки из палитры режима', async ({ page, request }) => {
  const token = await apiToken(request, ADMIN)
  const brand = await (await request.get(`${API}/api/cms/brand`, { headers: apiHeaders(token) })).json()
  const light = rgb(brand.tokens.palette.light.background)
  const dark = rgb(brand.tokens.palette.dark.background)
  expect(light, 'палитры режимов совпадают — проверка ничего не проверяет').not.toBe(dark)

  await signInToCms(page, ADMIN)
  await page.goto('/cms/brand')
  await expect(page.getByTestId('brand-editor')).toBeVisible({ timeout: 20_000 })
  const frame = page.frameLocator('[data-testid="brand-preview-stage-frame"]')
  await expect(frame.getByTestId('guest-home-hero')).toBeVisible({ timeout: 25_000 })
  const toggle = page.getByTestId('brand-preview-mode-toggle')
  const background = () => frame.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor)

  for (const [label, expected] of [
    ['Тёмная', dark],
    ['Светлая', light],
    ['Тёмная', dark],
  ] as const) {
    await toggle.getByText(label).click()
    await expect.poll(background, { timeout: 10_000, message: `«${label}»: показ не переключился` }).toBe(expected)
  }
})
