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
  // Меню приходит отдельным запросом (`/cms/navigation`) — ждём его, а не
  // читаем пустое место сразу после входа.
  await expect(page.getByTestId('cms-nav-orders')).toBeVisible({ timeout: 20_000 })
  const keys = (
    await page.$$eval('[data-testid^="cms-nav-"]', (els) =>
      els.map((el) => el.getAttribute('data-testid')!.replace('cms-nav-', '')),
    )
  ).filter((key) => !key.startsWith('group') && !['tracker', 'desk'].includes(key))
  expect(keys.length, 'меню пустое — сторож ничего не проверяет').toBeGreaterThan(5)

  const flush: string[] = []
  for (const key of keys) {
    const link = page.getByTestId(`cms-nav-${key}`)
    const href = await link.getAttribute('href')
    await link.click()
    /*
      ЖДЁМ НОВЫЙ РАЗДЕЛ, А НЕ ЛЮБОЙ ЗАГОЛОВОК. Заголовок ПРЕДЫДУЩЕГО раздела
      ещё виден сразу после клика, ожидание проходило мгновенно, а к замеру
      страница уже сменялась — `querySelector` возвращал null (партия 22,
      одна красная из 148). Сначала адрес нажатого пункта, потом замер
      локатором, который сам дожидается своего элемента.
    */
    if (href) await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\?|$)`), { timeout: 20_000 })
    const title = page.getByTestId('cms-page-title').first()
    await expect(title, `у раздела ${key} нет заголовка`).toBeVisible({ timeout: 20_000 })
    // Замер повторяется, пока обе рамки на месте: «Аналитика» перемонтирует
    // шапку, когда догружает область видимости, и узел заголовка на миг
    // пропадает — одиночный замер ловил эту щель (`boundingBox` → null).
    let gap = Number.NaN
    await expect
      .poll(
        async () => {
          const titleBox = await title.boundingBox()
          const mainBox = await page.locator('main').first().boundingBox()
          if (!titleBox || !mainBox) return false
          gap = Math.round(titleBox.x - mainBox.x)
          return true
        },
        { message: `раздел ${key}: заголовок или рабочая область не на экране`, timeout: 20_000 },
      )
      .toBe(true)
    if (gap < 16) flush.push(`${key}: ${gap}px`)
  }
  expect(flush, 'разделы без отступа от меню').toEqual([])
})
