import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken } from './helpers'
import { brandSession, guestPage, loadedFaces } from './brandGuest'

/**
 * КАЖДЫЙ ШРИФТ ИЗ РЕДАКТОРА БРЕНДА ЗАГРУЖАЕТСЯ И РИСУЕТ ТЕКСТ ГОСТЯ (партия 24).
 *
 * Редактор предлагал семь шрифтов, а `@font-face` было у двух: отель выбирал
 * Lora — имя уходило в тему, браузер не находил начертания и рисовал Georgia.
 * Проверка по вычисленному `font-family` этого не видела: там стояло «Lora».
 *
 * Список шрифтов берётся ИЗ API редактора, а не из этого файла: добавят в
 * редактор шрифт без файла — проверка покраснеет на нём. На каждый шрифт —
 * он ставится шрифтом текста, соседний — шрифтом заголовков, и на экране меню
 * гостя оба обязаны быть ЗАГРУЖЕНЫ (начертание в статусе `loaded`) и рисовать
 * свой текст.
 */

test('шрифты редактора: текст и заголовки гостя нарисованы выбранными гарнитурами', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000)
  const headers = apiHeaders(await apiToken(request, ADMIN))
  const body = await (await request.get(`${API}/api/cms/brand/fonts`, { headers })).json()
  const fonts = (Array.isArray(body) ? body : body.fonts) as Array<{ family: string; name: string }>
  expect(fonts.length, 'редактор не предлагает шрифтов — проверять нечего').toBeGreaterThan(1)

  const brand = await brandSession(request)
  const failures: string[] = []
  try {
    for (const [index, font] of fonts.entries()) {
      const heading = fonts[(index + 1) % fonts.length]
      await brand.apply({ typography: { fontFamily: font.family, headingFontFamily: heading.family } })
      const page = await guestPage(browser)
      await page.goto('/venue/kitchen')
      await expect(page.getByTestId('guest-menu')).toBeVisible({ timeout: 20_000 })

      await expect
        .poll(async () => {
          const faces = await loadedFaces(page)
          return faces.includes(font.name) && faces.includes(heading.name)
        }, { timeout: 15_000 })
        .toBe(true)
        .catch(() => failures.push(`${font.name}/${heading.name}: начертание не загружено`))

      const drawn = await page.evaluate(
        ({ body, head }) => {
          let bodyCount = 0
          let headCount = 0
          for (const el of document.querySelectorAll('body *')) {
            if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue
            const family = getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim()
            const isHeading = /^H[1-6]$/.test(el.tagName) || /MuiTypography-h[1-6]/.test(String(el.className))
            if (isHeading && family === head) headCount++
            if (!isHeading && family === body) bodyCount++
          }
          return { bodyCount, headCount }
        },
        { body: font.name, head: heading.name },
      )
      if (!drawn.bodyCount) failures.push(`${font.name}: ни одного текста этим шрифтом`)
      if (!drawn.headCount) failures.push(`${heading.name}: ни одного заголовка этим шрифтом`)
      await page.context().close()
    }
  } finally {
    await brand.restore()
  }
  expect(failures, 'шрифты редактора, которые гость не видит').toEqual([])
})
