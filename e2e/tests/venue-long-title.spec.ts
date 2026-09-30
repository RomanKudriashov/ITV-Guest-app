import { expect, test } from './fixtures'

import { ADMIN, API, HOTEL, apiToken } from './helpers'
import { guestPage } from './brandGuest'

/**
 * ДЛИННОЕ НАЗВАНИЕ ЗАВЕДЕНИЯ НЕ ЛОЖИТСЯ ПОД ВЕРХНИЕ КНОПКИ (партия 25).
 *
 * Шапка заведения на телефоне была фиксированной высоты, а название — прижато
 * к её низу: длинное название переносилось и росло ВВЕРХ, до кнопки «К
 * сервисам» и под стеклянную группу (номер, корзина, меню). У «Сиалии» —
 * на нескольких заведениях.
 *
 * Замер: у названия и у всех кнопок верхней полосы (назад и плавающая группа)
 * рамки не пересекаются, а от нижнего края полосы до названия — не меньше 8 px.
 * Условие явное: кухне ставится длинное публичное имя и возвращается прежнее.
 */

const LONG = 'Панорамный ресторан высокой кухни на двадцать пятом этаже с видом на старый город'

test('длинное название заведения на 390 — ниже верхних кнопок, с отступом', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const headers = { Authorization: `Bearer ${await apiToken(request, ADMIN)}`, 'X-Hotel-Subdomain': HOTEL }
  const services = (await (await request.get(`${API}/api/cms/services`, { headers })).json()).items as Array<{
    id: string
    code: string
  }>
  const kitchen = services.find((s) => s.code === 'kitchen')!
  const before = (await (await request.get(`${API}/api/cms/services/${kitchen.id}`, { headers })).json()).public_name
  const renamed = await request.patch(`${API}/api/cms/services/${kitchen.id}`, {
    headers,
    data: { public_name: { ...before, ru: LONG } },
  })
  expect(renamed.ok(), await renamed.text()).toBeTruthy()

  try {
    const page = await guestPage(browser, { width: 390 })
    await page.goto('/venue/kitchen')
    const name = page.getByTestId('guest-venue-name')
    await expect(name).toHaveText(LONG, { timeout: 20_000 })

    const { title, buttons } = await page.evaluate(() => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
      }
      const title = box(document.querySelector('[data-testid="guest-venue-name"]')!)
      // Верхняя полоса: кнопка «назад» и всё, что закреплено сверху экрана.
      const buttons = [document.querySelector('[data-testid="guest-venue-back"]')!]
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el)
        if (cs.position === 'fixed' && el.getBoundingClientRect().top < 80 && el.getBoundingClientRect().height < 80) {
          if (el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0) buttons.push(el)
        }
      }
      return { title, buttons: buttons.map((el) => ({ id: el.getAttribute('data-testid') ?? el.tagName, ...box(el) })) }
    })
    expect(buttons.length, 'верхних кнопок не нашлось — замер пуст').toBeGreaterThan(1)
    for (const button of buttons) {
      const overlaps =
        title.left < button.right && title.right > button.left && title.top < button.bottom && title.bottom > button.top
      expect(overlaps, `название легло под «${button.id}»`).toBe(false)
    }
    const barBottom = Math.max(...buttons.map((b) => b.bottom))
    expect(title.top - barBottom, 'название прижато к верхней полосе').toBeGreaterThanOrEqual(8)
    await page.context().close()
  } finally {
    await request.patch(`${API}/api/cms/services/${kitchen.id}`, { headers, data: { public_name: before } })
  }
})
