import { expect, test, type Page } from '@playwright/test'

import { DEMO_ROOM } from './helpers'

/**
 * Режим просмотра — гость вошёл «просто посмотреть меню», без номера.
 *
 * Два факта, каждый из которых был сломан:
 *
 *  1. ВЫЙТИ ИЗ РЕЖИМА БЫЛО НЕЧЕМ. Чип номера в шапке рисовался только при
 *     наличии номера, а в режиме просмотра его нет — ни кнопки, ни пункта меню.
 *     Назад по истории вело на ту же витрину, и единственным выходом оставалась
 *     чистка хранилища руками.
 *
 *  2. ПЛАШКА О РЕЖИМЕ БЫЛА НЕ ВИДНА. Не по контрасту — цвета были верные, — а
 *     потому, что панель каталога подтянута вверх и наезжала на неё скруглением:
 *     нижнюю половину строки закрывало.
 */

async function browseWithoutRoom(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.goto('/')
  await page.getByTestId('guest-browse-only').click()
  await expect(page.getByTestId('guest-home-bento')).toBeVisible({ timeout: 20_000 })
}

test.describe('Режим просмотра без номера', () => {
  test('из режима просмотра гость одним действием возвращается ко входу', async ({ page }) => {
    await browseWithoutRoom(page)

    // Чип номера подменён входом по номеру — это и есть выход из режима.
    const identify = page.getByTestId('guest-identify').first()
    await expect(identify).toBeVisible()
    await identify.click()

    // Экран входа: у гостя нет учётной записи, он представляется номером.
    await expect(page.getByTestId('guest-room-input')).toBeVisible({ timeout: 15_000 })

    // И этот путь ведёт к обычной сессии — режим действительно покинут.
    await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
    await page.getByTestId('guest-room-submit').click()
    await expect(page.getByTestId('guest-home-bento')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('guest-room-chip').first()).toBeVisible()
  })

  for (const mode of ['dark', 'light'] as const) {
    test(`плашка о режиме просмотра читается целиком (${mode})`, async ({ page }) => {
      await page.goto('/')
      await page.evaluate((m) => {
        window.localStorage.clear()
        window.localStorage.setItem('itv.theme-mode', m)
      }, mode)
      await browseWithoutRoom(page)
      await page.getByTestId('guest-home-tile-kitchen').click()

      const notice = page.getByTestId('guest-view-only-notice')
      await expect(notice).toBeVisible({ timeout: 20_000 })

      // Контраст: текст и подложка обязаны расходиться по светлоте. Плашка
      // светлым по светлому — ровно то, чего здесь быть не должно.
      const { color, bg } = await notice.evaluate((node) => {
        const cs = getComputedStyle(node)
        return { color: cs.color, bg: cs.backgroundColor }
      })
      const lum = (c: string) => {
        const [r, g, b] = (c.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).map(Number)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      expect(Math.abs(lum(color) - lum(bg)), `${mode}: текст и фон плашки`).toBeGreaterThan(90)

      // Не перекрыта: панель каталога подтянута вверх и раньше срезала строку.
      // Сравниваем с элементом, который лежит поверх, — липкой строкой категорий.
      const noticeBox = await notice.boundingBox()
      const bar = page.getByTestId('guest-category-bar').first()
      // Строка категорий обязана существовать — иначе проверка перекрытия
      // молча ничего не проверяет, а это хуже её отсутствия.
      await expect(bar).toBeVisible()
      const barBox = await bar.boundingBox()
      expect(noticeBox && barBox).toBeTruthy()
      expect(
        noticeBox!.y + noticeBox!.height,
        `${mode}: низ плашки не должен уходить под строку категорий`,
      ).toBeLessThanOrEqual(barBox!.y + 1)
    })
  }
})
