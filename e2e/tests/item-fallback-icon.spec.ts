import { expect, test } from './fixtures'

import { guestPage } from './brandGuest'

/**
 * ЗАГЛУШКА БЕЗ ФОТО — ПО ТИПУ ЗАВЕДЕНИЯ, А НЕ «ВИЛКА И НОЖ» ВСЕМ (партия 29).
 *
 * У товара вид предложения всегда `product`, и подушка хозслужбы или масло
 * спа без фото получали приборы. Теперь сервер отдаёт у позиции тип
 * заведения (`service_type`), и витрина рисует знак по нему.
 *
 * На демо-отелях товаров не-еды нет (дефект виден на данных «Сиалии»),
 * поэтому условие задаётся в браузере: ответ каталога подменяется — у двух
 * позиций убирается фото, одной ставится заведение-хозслужба, другой — спа.
 * Стенд не меняется. Что сервер отдаёт `service_type` правильно — pytest.
 */

test('позиция без фото: знак по типу заведения — уборка, ванна, приборы', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await guestPage(browser, { width: 390 })
  const picked: Record<string, string> = {}
  await page.route('**/api/**/guest/catalog**', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    const items = (body.categories ?? []).flatMap((c: { items: Array<Record<string, unknown>> }) => c.items)
    const plan: Array<[string, string]> = [
      ['housekeeping', 'make-up-room'],
      ['spa', 'bath'],
      ['restaurant', 'restaurant'],
    ]
    plan.forEach(([serviceType, icon], index) => {
      const item = items[index]
      if (!item) return
      item.images = []
      item.service_type = serviceType
      picked[item.code as string] = icon
    })
    await route.fulfill({ response, json: body })
  })
  await page.goto('/venue/kitchen')
  await expect.poll(() => Object.keys(picked).length, { timeout: 20_000 }).toBe(3)
  for (const [code, icon] of Object.entries(picked)) {
    const row = page.getByTestId(`guest-item-${code}`)
    await expect(row).toBeVisible({ timeout: 20_000 })
    await expect(row.locator('svg[data-icon]').first(), `${code}: заглушка`).toHaveAttribute('data-icon', icon)
  }
  await page.context().close()
})
