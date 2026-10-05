import { expect, test } from './fixtures'

import { ADMIN, signInToCms } from './helpers'

/**
 * ТАБЛИЦА НОМЕРНОГО ФОНДА НА 768 PX (партия 30, п.43, аудит ADM-007).
 *
 * Крайняя колонка обрезалась правым краем без признака прокрутки, действия
 * (QR, выезд, правка, удаление) сжимались в столбик. Теперь: страница вбок не
 * прокручивается, таблица прокручивается сама, и после прокрутки последняя
 * кнопка видна целиком; действия — в одну строку.
 */

// 390 — партия 31: QA (DEV-03) мерил и телефон, а проверка держала только 768.
for (const width of [768, 390]) test(`${width} px: страница без горизонтальной прокрутки, действия таблицы достижимы и в строку`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 })
  await signInToCms(page, ADMIN)
  await page.goto('/cms/rooms')
  await page.getByTestId('rooms-view-list').click().catch(() => {})
  const scroller = page.getByTestId('rooms-table-scroll')
  await expect(scroller).toBeVisible({ timeout: 20_000 })

  const page_ = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(page_.scroll, 'страница прокручивается вбок').toBeLessThanOrEqual(page_.client)

  await scroller.evaluate((el) => {
    el.scrollLeft = el.scrollWidth
  })
  const row = page.locator('[data-testid^="room-delete-"]').first()
  const box = await row.boundingBox()
  const area = (await scroller.boundingBox())!
  expect(box, 'кнопки удаления не нашлось').toBeTruthy()
  expect(box!.x + box!.width, 'последняя кнопка обрезана краем таблицы').toBeLessThanOrEqual(area.x + area.width + 1)
  expect(box!.x + box!.width, 'последняя кнопка за краем экрана').toBeLessThanOrEqual(width)

  const code = (await row.getAttribute('data-testid'))!.replace('room-delete-', '')
  const tops = await Promise.all(
    ['qr', 'checkout', 'edit', 'delete'].map(async (kind) => (await page.getByTestId(`room-${kind}-${code}`).boundingBox())!.y),
  )
  expect(Math.max(...tops) - Math.min(...tops), 'действия сжаты в столбик').toBeLessThan(4)
})
