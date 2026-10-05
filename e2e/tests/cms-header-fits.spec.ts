import { expect, test } from './fixtures'

import { ADMIN, settleNetwork, signIn } from './helpers'

/**
 * ШАПКА ПАНЕЛИ УМЕЩАЕТСЯ НА ТЕЛЕФОНЕ (партия 31, DEV-08 QA).
 *
 * QA: на 390 px кнопка профиля кончалась на 394 px при рабочей ширине 375
 * (полоса прокрутки) — на заказах, номерах, аналитике. Сторож: каждый
 * элемент шапки внутри рабочей ширины на 360 и 390 на всех разделах.
 * Рабочая ширина — `documentElement.clientWidth`: она уже за вычетом полосы.
 */

const SECTIONS = [
  '/cms/dashboard',
  '/cms/orders',
  '/cms/rooms',
  '/cms/analytics',
  '/cms/services',
  '/cms/staff',
  '/cms/notifications',
  '/cms/reviews',
  '/cms/brand',
  '/cms/settings',
  '/cms/dictionaries',
  '/cms/profile',
]

for (const width of [360, 390]) {
  test(`шапка панели на ${width}px — все элементы в рабочей ширине`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width, height: 800 })
    await signIn(page, ADMIN)
    const overflow: string[] = []
    for (const path of SECTIONS) {
      await page.goto(path)
      await expect(page.getByTestId('hotel-name')).toBeVisible({ timeout: 20_000 })
      await settleNetwork(page)
      const result = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth
        const bar = document.querySelector('header .MuiToolbar-root')
        if (!bar) return ['шапка не найдена']
        const out: string[] = []
        for (const el of Array.from(bar.children) as HTMLElement[]) {
          const box = el.getBoundingClientRect()
          if (box.width === 0) continue
          if (box.right > limit + 0.5 || box.left < -0.5) {
            out.push(`${el.dataset.testid ?? el.getAttribute('aria-label') ?? el.tagName}: ${Math.round(box.left)}–${Math.round(box.right)} при ширине ${limit}`)
          }
        }
        return out
      })
      for (const line of result) overflow.push(`${path}: ${line}`)
    }
    expect(overflow, 'элементы шапки за краем рабочей ширины').toEqual([])
  })
}
