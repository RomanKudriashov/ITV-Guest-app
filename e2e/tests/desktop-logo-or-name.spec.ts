import { expect, test } from './fixtures'

import { brandSession, guestPage, uploadBrandMedia } from './brandGuest'
import { pngRGBA } from './pngFixture'

/**
 * ПК 1440: ЛОГОТИП ИЛИ ИМЯ ОТЕЛЯ — НЕ ОБА (партия 29).
 *
 * Логотип и есть имя отеля: рядом с ним то же имя прописью читалось дублем.
 * Есть логотип — имени текстом нет, оно в `alt` знака; нет логотипа — имя
 * текстом, как раньше. Условие явное: логотип ставится и снимается, бренд
 * возвращается.
 */

const MARK = pngRGBA(160, 160, (x, y) => ((x - 80) ** 2 + (y - 80) ** 2 < 60 ** 2 ? [40, 90, 160, 255] : [255, 255, 255, 0]))

test('ПК 1440: с логотипом имя только в alt, без логотипа — текстом', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const brand = await brandSession(request)
  try {
    await brand.apply({ brand: { logoLight: '', logoDark: '' } })
    let page = await guestPage(browser, { width: 1440 })
    await expect(page.getByTestId('guest-topbar-name')).toBeVisible({ timeout: 20_000 })
    const name = ((await page.getByTestId('guest-topbar-name').textContent()) ?? '').trim()
    expect(name, 'имя отеля без логотипа — текстом').not.toEqual('')
    await page.context().close()

    const url = await uploadBrandMedia(request, { name: 'mark.png', mimeType: 'image/png', buffer: MARK })
    await brand.apply({ brand: { logoLight: url, logoDark: url } })
    page = await guestPage(browser, { width: 1440 })
    const logo = page.getByTestId('guest-topbar-logo')
    await expect(logo).toBeVisible({ timeout: 20_000 })
    await expect(logo, 'имя отеля — в alt логотипа').toHaveAttribute('alt', name)
    const text = await page.getByTestId('guest-topbar-brand').evaluate((el) => (el as HTMLElement).innerText.trim())
    expect(text, 'рядом с логотипом имя текстом не дублируется').toEqual('')
    await expect(page.getByTestId('guest-topbar-name')).toHaveCount(0)
    await page.context().close()
  } finally {
    await brand.restore()
  }
})
