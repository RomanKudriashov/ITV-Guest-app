import { expect, test, type Page } from '@playwright/test'

import { ADMIN, signInToCms } from './helpers'

/*
  РАЗМЕР И ЦВЕТ ТЕКСТА: ПРОВЕРЯЕМ БУКВЫ, А НЕ ОРГАНЫ УПРАВЛЕНИЯ.

  Обе настройки лежали в модели и доезжали до темы — не было органа. Соблазн
  проверить «ползунок сдвинулся, поле приняло значение» здесь особенно велик и
  особенно бесполезен: ровно так в заходе 2 остались зелёными все проверки,
  пока показ рисовался вообще без оформления.

  Поэтому здесь меряется ВЫЧИСЛЕННЫЙ стиль текста внутри рамки показа: кегль в
  пикселях и цвет. Условия задаются явно — ползунок ставится в известное
  положение клавишами, цвет вводится нативным событием, — и ничего не
  сохраняется: черновик живёт в панели, стенд остаётся каким был.
*/

async function openBrand(page: Page): Promise<void> {
  await signInToCms(page, ADMIN)
  await page.goto('/cms/brand')
  await expect(page.getByTestId('brand-editor')).toBeVisible({ timeout: 20_000 })

  /*
    РЕЖИМ ЗАДАЁМ, А НЕ ЧИТАЕМ. Редактор правит палитру ТОГО режима, который
    выбран в показе, и у «Кристалла» по умолчанию тёмный: почти белый текст там
    читается прекрасно, и проверка контраста падала на исправном коде. Тот же
    класс, что и со стилем поверхности, — условие живёт в тесте.
  */
  await page.getByTestId('brand-preview-mode-toggle').getByText('Светлая').click()
}

function frame(page: Page) {
  return page.frameLocator('[data-testid="brand-preview-stage-frame"]')
}

/** Кегль основного текста витрины — в пикселях, как его видит гость. */
async function bodyFontSize(page: Page): Promise<number> {
  const hero = frame(page).getByTestId('guest-home-hero')
  await expect(hero, 'парадная в показе не нарисовалась').toBeVisible({ timeout: 25_000 })
  return hero.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))
}

/** Ползунок в известное положение: Home — минимум, End — максимум. */
async function setSlider(page: Page, testId: string, edge: 'Home' | 'End'): Promise<void> {
  const slider = page.getByTestId(testId).locator('input')
  await slider.focus()
  await page.keyboard.press(edge)
}

test.describe('Размер текста', () => {
  test('кегль из редактора меняет буквы в показе, а не только ползунок', async ({ page }) => {
    await openBrand(page)

    // Минимум и максимум — явные условия, а не «то, что стояло у отеля».
    await setSlider(page, 'brand-font-size', 'Home')
    const small = await bodyFontSize(page)

    await setSlider(page, 'brand-font-size', 'End')
    await expect
      .poll(() => bodyFontSize(page), {
        timeout: 10_000,
        message: 'кегль подняли до предела, а буквы в показе прежние',
      })
      .toBeGreaterThan(small)

    // Ползунок и буквы должны говорить одно и то же: подпись над ним — тоже
    // часть ответа оператору.
    await expect(page.getByTestId('brand-editor')).toContainText('20px')
  })

  test('масштаб заголовков меняет заголовок, а не весь текст', async ({ page }) => {
    await openBrand(page)

    const title = frame(page).getByTestId('guest-home-hero').locator('h1, h2, h3').first()
    await expect(title, 'заголовка в парадной нет').toBeVisible({ timeout: 25_000 })
    const read = () =>
      title.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))

    await setSlider(page, 'brand-heading-scale', 'Home')
    const small = await read()

    await setSlider(page, 'brand-heading-scale', 'End')
    await expect
      .poll(read, {
        timeout: 10_000,
        message: 'масштаб заголовков подняли, а заголовок прежний',
      })
      .toBeGreaterThan(small)
  })
})

test.describe('Цвет текста', () => {
  test('выбранный цвет доезжает до букв в показе', async ({ page }) => {
    await openBrand(page)

    const field = page.getByTestId('brand-text-color')
    await expect(field).toBeVisible()

    // Нативное событие: `type="color"` обычный ввод не принимает, а редактор
    // слушает именно его.
    await field.evaluate((node) => {
      const input = node as HTMLInputElement
      input.value = '#b3001b'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const hero = frame(page).getByTestId('guest-home-hero')
    await expect(hero).toBeVisible({ timeout: 25_000 })
    await expect
      .poll(() => hero.evaluate((node) => getComputedStyle(node).color), {
        timeout: 10_000,
        message: 'цвет текста выбрали, а буквы в показе прежнего цвета',
      })
      .toBe('rgb(179, 0, 27)')
  })

  test('нечитаемый цвет предупреждает, но не запрещает', async ({ page }) => {
    await openBrand(page)

    /*
      УСЛОВИЕ ЗАДАЁМ, А НЕ ЧИТАЕМ. Берём цвет, заведомо неразличимый на любой
      светлой поверхности, — почти белый. Опираться на то, какой цвет стоит у
      отеля сейчас, нельзя: проверка зеленела бы через раз и сама оставляла бы
      стенд в новом состоянии.
    */
    await page.getByTestId('brand-text-color').evaluate((node) => {
      const input = node as HTMLInputElement
      input.value = '#fdfdfb'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const warning = page.getByTestId('brand-text-contrast')
    await expect(warning, 'про нечитаемый текст не сказано ни слова').toBeVisible({
      timeout: 10_000,
    })
    await expect(warning).toContainText(/4[.,]5/)

    // Не запрещает: сохранить можно, выбор за отелем.
    await expect(page.getByTestId('brand-save')).toBeEnabled()

    // А читаемый цвет предупреждение снимает — иначе это не проверка, а
    // постоянно горящая лампа.
    await page.getByTestId('brand-text-color').evaluate((node) => {
      const input = node as HTMLInputElement
      input.value = '#101418'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await expect(warning).toBeHidden({ timeout: 10_000 })
  })
})

test.describe('Размер текста доходит до того, что гость читает', () => {
  test('название, описание и цена в карточке меню слушают ползунок', async ({ page }) => {
    /*
      ИМЕННО ЭТИ ТРИ СТРОКИ БЫЛИ МЁРТВЫМИ.

      Ползунок двигал наследуемый текст и не трогал ни одного места, ради
      которого настройку и просят: название позиции стояло 15px, описание 12px,
      цена 19px — жёстко, в пикселях и в rem. Проверка меряет их, а не ползунок.
    */
    await openBrand(page)
    await page.getByTestId('brand-preview-screen').click()
    await page.getByTestId('brand-preview-screen-catalog').click()

    const card = frame(page).locator('[data-testid^="guest-item-"]').first()
    await expect(card, 'в показе нет карточки меню').toBeVisible({ timeout: 25_000 })

    const sizes = () =>
      card.evaluate((node) =>
        [...node.querySelectorAll('*')]
          .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim().length > 1)
          .slice(0, 6)
          .map((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
      )

    await setSlider(page, 'brand-font-size', 'Home')
    const small = await sizes()
    expect(small.length, 'в карточке не нашлось текста для замера').toBeGreaterThan(2)

    await setSlider(page, 'brand-font-size', 'End')
    await expect
      .poll(sizes, {
        timeout: 10_000,
        message: 'кегль подняли, а строки карточки остались прежними',
      })
      .not.toEqual(small)

    const big = await sizes()
    for (let i = 0; i < small.length; i += 1) {
      expect(big[i], `строка ${i + 1} карточки не выросла`).toBeGreaterThan(small[i])
    }
  })
})
