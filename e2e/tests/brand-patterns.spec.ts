import { expect, test, type Page } from '@playwright/test'

import { ADMIN, login } from './helpers'

/*
  ПАТТЕРНЫ ФОНА: ПРОВЕРЯЕМ ФОН, А НЕ ПЛИТКУ ВЫБОРА.

  Паттерн выбирался в редакторе и НЕ ДОЕЗЖАЛ до гостя вовсе: ссылку на фактуру
  полагалось передать снаружи, и её не передавал никто. Оператор сохранял выбор,
  а экран оставался ровным цветом — включая четыре пресета библиотеки, которые
  идут с паттерном по умолчанию.

  Заметить это проверкой «плитка выбрана, у неё рамка» было нельзя: плитка
  работала исправно. Поэтому здесь меряется `background-image` НА ЭКРАНЕ ГОСТЯ.
*/

async function openBrand(page: Page): Promise<void> {
  await login(page, ADMIN)
  await page.goto('/cms/brand')
  await expect(page.getByTestId('brand-editor')).toBeVisible({ timeout: 20_000 })
}

/** Вид фона задаём явно: полагаться на то, что стоит у отеля, нельзя. */
async function chooseAbstraction(page: Page, code: string): Promise<void> {
  await page.getByTestId('brand-bg-kind').click()
  await page.getByRole('option', { name: 'Паттерн', exact: true }).click()
  await page.getByTestId(`brand-abstraction-${code}`).click()
}

function frame(page: Page) {
  return page.frameLocator('[data-testid="brand-preview-stage-frame"]')
}

/** Слой фона на экране входа — тот, что несёт фактуру. */
async function backdropImage(page: Page): Promise<string> {
  const input = frame(page).getByTestId('guest-room-input')
  await expect(input, 'экран входа в показе не открылся').toBeVisible({ timeout: 25_000 })
  return frame(page)
    .locator('body')
    .evaluate((body) => {
      const walk = (el: Element, depth: number): string => {
        if (depth > 4) return ''
        const image = getComputedStyle(el).backgroundImage
        if (image.includes('svg+xml')) return image
        for (const kid of el.children) {
          const found = walk(kid, depth + 1)
          if (found) return found
        }
        return ''
      }
      return walk(body, 0)
    })
}

test.describe('Паттерн фона доезжает до гостя', () => {
  test('выбранная фактура рисуется на экране гостя, а не только в плитке', async ({ page }) => {
    await openBrand(page)
    await page.getByTestId('brand-preview-screen').click()
    await page.getByTestId('brand-preview-screen-entry').click()

    await chooseAbstraction(page, 'waves')
    const waves = await backdropImage(page)
    expect(waves, 'фактуры на экране гостя нет вовсе').toContain('svg+xml')
  })

  test('другая фактура — другой фон, а не тот же самый', async ({ page }) => {
    await openBrand(page)
    await page.getByTestId('brand-preview-screen').click()
    await page.getByTestId('brand-preview-screen-entry').click()

    await chooseAbstraction(page, 'waves')
    const waves = await backdropImage(page)

    await page.getByTestId('brand-abstraction-linen').click()
    await expect
      .poll(() => backdropImage(page), {
        timeout: 10_000,
        message: 'сменили фактуру, а фон остался прежним',
      })
      .not.toBe(waves)
  })

  test('фактура окрашена темой, а не серой заглушкой сервера', async ({ page }) => {
    /*
      Серый `#889096` — цвет заглушки, которой сервер рисует плитки выбора. На
      витрине фактура обязана быть цвета текста: на тёмном фоне серые линии
      пропадают, на светлом — грязнят.
    */
    await openBrand(page)
    await page.getByTestId('brand-preview-screen').click()
    await page.getByTestId('brand-preview-screen-entry').click()

    await chooseAbstraction(page, 'marble')
    const image = await backdropImage(page)

    expect(image, 'на витрине серая заглушка сервера').not.toContain('889096')
    expect(decodeURIComponent(image), 'в фактуре нет ни одного цвета').toMatch(/stroke="#|stroke="rgb/)
  })
})
