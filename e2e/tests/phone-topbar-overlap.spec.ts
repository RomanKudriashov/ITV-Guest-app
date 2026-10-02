import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { brandSession, guestPage, uploadBrandMedia } from './brandGuest'
import { pngRGBA } from './pngFixture'

/**
 * ЛОГОТИП НЕ ЛОЖИТСЯ НА КНОПКИ ВЕРХНЕЙ ПОЛОСЫ ТЕЛЕФОНА (партия 29).
 *
 * В партии 25 логотип встал в плавающую группу (номер, корзина, меню). Группа
 * растёт влево, и у «Сиалии» логотип лёг на «К сервисам» шапки заведения. Теперь
 * логотип показывается, только если с ним группа не доходит до кнопок слева.
 *
 * Замер — прямоугольники всех элементов верхней полосы (кнопка «назад» и
 * каждый видимый элемент группы) попарно не пересекаются; на 390 и 360.
 * Условие явное: отелю ставится широкий логотип, бренд возвращается.
 */

const INK: [number, number, number, number] = [30, 30, 40, 255]
const CLEAR: [number, number, number, number] = [255, 255, 255, 0]
/** Широкий знак-надпись 4:1 — упирается в предел ширины логотипа. */
const WIDE = pngRGBA(400, 100, (x, y) => (y > 20 && y < 80 && x % 40 < 30 ? INK : CLEAR))

async function overlaps(page: Page): Promise<{ boxes: number; hits: string[] }> {
  return page.evaluate(() => {
    const elements: Element[] = []
    const back = document.querySelector('[data-testid="guest-venue-back"]')
    if (back) elements.push(back)
    const group = document.querySelector('[data-testid="guest-floating-group"]')
    if (group) elements.push(...group.children)
    const boxes = elements
      .filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { id: (el as HTMLElement).dataset.testid ?? el.tagName.toLowerCase(), l: r.left, r: r.right, t: r.top, b: r.bottom }
      })
      .filter((b) => b.r - b.l > 0 && b.b - b.t > 0)
    const hits: string[] = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const c = boxes[j]
        if (a.l < c.r && a.r > c.l && a.t < c.b && a.b > c.t) hits.push(`${a.id} ∩ ${c.id}`)
      }
    }
    return { boxes: boxes.length, hits }
  })
}

test('широкий логотип не ложится на «К сервисам» и кнопки группы — 390 и 360', async ({ browser, request }) => {
  test.setTimeout(150_000)
  const brand = await brandSession(request)
  try {
    const url = await uploadBrandMedia(request, { name: 'wide.png', mimeType: 'image/png', buffer: WIDE })
    await brand.apply({ brand: { logoLight: url, logoDark: url } })

    for (const width of [390, 360]) {
      const page = await guestPage(browser, { width })
      // Главная: кнопки слева нет — логотипу место есть, он виден.
      await expect(page.getByTestId('guest-phone-logo'), `${width}: на главной логотип виден`).toBeVisible({ timeout: 20_000 })

      await page.goto('/venue/kitchen')
      await expect(page.getByTestId('guest-venue-back')).toBeVisible({ timeout: 20_000 })
      await page.waitForTimeout(800)
      const { boxes, hits } = await overlaps(page)
      expect(boxes, `${width}: верхняя полоса не найдена — замер пуст`).toBeGreaterThan(2)
      expect(hits, `${width}: элементы верхней полосы пересекаются`).toEqual([])
      await page.context().close()
    }
  } finally {
    await brand.restore()
  }
})

test('режим просмотра: «Войти по номеру» не ложится на «К сервисам» — с логотипом и без, 390 и 360', async ({
  browser,
  request,
}) => {
  test.setTimeout(150_000)
  const brand = await brandSession(request)
  try {
    for (const withLogo of [false, true]) {
      if (withLogo) {
        const url = await uploadBrandMedia(request, { name: 'wide.png', mimeType: 'image/png', buffer: WIDE })
        await brand.apply({ brand: { logoLight: url, logoDark: url } })
      } else {
        await brand.apply({ brand: { logoLight: '', logoDark: '' } })
      }
      for (const width of [390, 360]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ru-RU' })
        const page = await context.newPage()
        await page.goto('/')
        await page.getByTestId('guest-browse-only').click()
        await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
        await page.goto('/venue/kitchen')
        await expect(page.getByTestId('guest-venue-back')).toBeVisible({ timeout: 20_000 })
        await page.waitForTimeout(800)
        const label = withLogo ? 'с логотипом' : 'без логотипа'
        const { boxes, hits } = await overlaps(page)
        expect(boxes, `${width}, ${label}: верхняя полоса не найдена`).toBeGreaterThan(2)
        expect(hits, `${width}, ${label}: элементы верхней полосы пересекаются`).toEqual([])
        // Вход по номеру остаётся — значком или текстом, но доступен.
        await expect(page.getByTestId('guest-identify')).toBeVisible()
        await expect(page.getByTestId('guest-identify')).toHaveAccessibleName(/номер/i)
        await context.close()
      }
    }
  } finally {
    await brand.restore()
  }
})
