import { expect, test } from './fixtures'

import { login } from './helpers'

/**
 * У КАЖДОГО РАЗДЕЛА ПАНЕЛИ — ОТСТУП ОТ МЕНЮ (ADM-006 внешнего аудита).
 *
 * Оболочка отступов не даёт: `<Outlet />` голый, каждая страница отступает
 * сама (`sx={{ p: 3 }}` у корня). «Заказы» и «Отзывы» забыли — заголовок
 * начинался вплотную за разделителем меню, фильтры доходили до полосы
 * прокрутки. Замер 29.09.2026 на 1440 px: у соседей 24 px, у этих двух 0.
 *
 * Сторож обходит ВСЕ пункты меню, а не два известных: следующая страница без
 * отступа краснеет здесь, а не у внешнего аудитора. Порог — 16 px: страницы с
 * узкой центрированной колонкой (бренд, справочники) законно отступают больше.
 */

test('у каждого раздела заголовок не прижат к меню', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  const keys = (
    await page.$$eval('[data-testid^="cms-nav-"]', (els) =>
      els.map((el) => el.getAttribute('data-testid')!.replace('cms-nav-', '')),
    )
  ).filter((key) => !key.startsWith('group') && !['tracker', 'desk'].includes(key))
  expect(keys.length, 'меню пустое — сторож ничего не проверяет').toBeGreaterThan(5)

  const flush: string[] = []
  for (const key of keys) {
    await page.getByTestId(`cms-nav-${key}`).click()
    const title = page.getByTestId('cms-page-title').first()
    await expect(title, `у раздела ${key} нет заголовка`).toBeVisible({ timeout: 20_000 })
    const gap = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="cms-page-title"]')!.getBoundingClientRect()
      const main = document.querySelector('main')!.getBoundingClientRect()
      return Math.round(t.left - main.left)
    })
    if (gap < 16) flush.push(`${key}: ${gap}px`)
  }
  expect(flush, 'разделы без отступа от меню').toEqual([])
})
