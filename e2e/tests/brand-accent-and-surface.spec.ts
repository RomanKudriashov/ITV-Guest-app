import { expect, test, type Page } from '@playwright/test'

import { ADMIN, API, apiToken, HOTEL, login } from './helpers'

/**
 * ПАРТИЯ 7, ЗАХОД 1, ПУНКТ 3: НАСТРОЙКИ, КОТОРЫЕ НАКОНЕЦ ЧТО-ТО МЕНЯЮТ.
 *
 * Акцент отеля сохранялся, доезжал до гостя и не был виден нигде, кроме звёзд
 * отзыва на странице статуса заказа. Стиль поверхности работал наоборот: в
 * показе виден, у гостя нет.
 *
 * Проверки идут по живому стенду и НИЧЕГО НЕ СОХРАНЯЮТ: оформление демо-отеля
 * трогать нельзя — по нему смотрят все остальные укусы. Там, где нужен другой
 * цвет, он задаётся в черновике редактора и остаётся черновиком.
 */

/** `rgb(r, g, b)` → `#rrggbb`, чтобы сравнивать с тем, что задано в палитре. */
function toHex(rgb: string): string {
  const nums = rgb.match(/\d+/g)?.slice(0, 3).map(Number) ?? []
  if (nums.length < 3) return rgb
  return `#${nums.map((n) => n.toString(16).padStart(2, '0')).join('')}`.toLowerCase()
}

async function openBrand(page: Page): Promise<void> {
  await login(page, ADMIN)
  await page.goto('/cms/brand')
  await expect(page.getByTestId('brand-preview')).toBeVisible({ timeout: 25_000 })
}

test.describe('Акцент отеля виден', () => {
  test('метка роли «Акцент» покрашена акцентом отеля, а не основным цветом', async ({
    page,
    request,
  }) => {
    const token = await apiToken(request, ADMIN)
    const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }

    const badges = await request.get(`${API}/api/cms/badges`, { headers })
    const rows = (await badges.json()).items as { id: string; color_role: string }[]
    const accentBadge = rows.find((row) => row.color_role === 'accent')
    expect(accentBadge, 'в наборе нет метки роли «Акцент» — проверять нечего').toBeTruthy()

    const brand = await request.get(`${API}/api/cms/brand`, { headers })
    expect(brand.ok()).toBeTruthy()
    const palette = (await brand.json()).tokens.palette as Record<
      'light' | 'dark',
      { primary: string; secondary: string }
    >

    /*
      РЕЖИМ ПАНЕЛИ ЗАРАНЕЕ НЕИЗВЕСТЕН — он личная настройка сотрудника. Поэтому
      сравниваем с акцентом ОБОИХ режимов и отдельно требуем, чтобы это не был
      основной цвет: именно его роль «Акцент» возвращала до правки, и именно
      эту подмену проверка обязана ловить.
    */
    const accents = [palette.light.secondary, palette.dark.secondary].map((c) => c.toLowerCase())
    const primaries = [palette.light.primary, palette.dark.primary].map((c) => c.toLowerCase())

    await login(page, ADMIN)
    await page.goto('/cms/marketing')
    const pill = page.getByTestId(`cms-badge-pill-${accentBadge!.id}`)
    await expect(pill).toBeVisible({ timeout: 25_000 })
    const fill = await pill.evaluate((node) => getComputedStyle(node).backgroundColor)

    /*
      СРАВНИВАЕМ С НАСТРОЙКОЙ, А НЕ С КОНСТАНТОЙ. Роль называется «Акцент», и
      до этой правки возвращала `primary` — то есть основной цвет отеля.
      Проверка падала бы ровно в том случае, ради которого написана: акцент
      снова перестал быть акцентом.
    */
    const hex = toHex(fill)
    expect(accents, `метка роли «Акцент» покрашена цветом ${hex}, которого нет в акцентах`).toContain(
      hex,
    )
    expect(primaries, 'метка роли «Акцент» снова покрашена ОСНОВНЫМ цветом').not.toContain(hex)
  })

  test('неразличимый акцент предупреждает, но не запрещает', async ({ page }) => {
    await openBrand(page)

    /*
      РЕЖИМ ЗАДАЁТСЯ ЯВНО, иначе проверка зависит от личной настройки
      сотрудника: панель номера в тёмной теме стоит на почти чёрной подложке, и
      «почти белый» акцент на ней как раз РАЗЛИЧИМ. Светлая тема — подложка
      rgba(255,255,255,.70), и тот же цвет на ней неразличим.
    */
    await page
      .getByTestId('brand-preview-mode-toggle')
      .getByRole('button', { name: /светл/i })
      .click()

    const field = page.getByTestId('brand-accent')
    await expect(field).toBeVisible()

    /*
      Значение ставится нативно: `type="color"` не принимает обычный ввод, а
      редактор слушает именно нативное событие.
    */
    await field.evaluate((node) => {
      const input = node as HTMLInputElement
      input.value = '#fdfdfb'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const warning = page.getByTestId('brand-accent-spare')
    await expect(warning, 'про запасной цвет не сказано ни слова').toBeVisible({ timeout: 10_000 })
    await expect(warning).toContainText(/запасной/i)

    // ПРЕДУПРЕЖДАЕТ, НО НЕ ЗАПРЕЩАЕТ: значение принято, поле держит выбранное,
    // кнопка сохранения жива. Запрет здесь был бы хуже — отель вправе выбрать
    // бледный акцент, если управление номером ему не продано.
    expect(await field.inputValue()).toBe('#fdfdfb')
    await expect(page.getByTestId('brand-save')).toBeEnabled()
  })
})

test.describe('Стиль поверхности доезжает до витрины', () => {
  test('смена стиля меняет карточку в показе — тем же кодом, что у гостя', async ({ page }) => {
    await openBrand(page)

    /*
      КАРТОЧКА БЕРЁТСЯ ВНУТРИ РАМКИ ПОКАЗА. Показ больше не собирает экран
      руками: он рисует настоящее меню заведения в своём окне, и карточка там —
      та же `guest-item-*`, что видит гость.
    */
    await page.getByTestId('brand-preview-screen').click()
    await page.getByTestId('brand-preview-screen-catalog').click()
    const frame = page.frameLocator('[data-testid="brand-preview-stage-frame"]')
    const card = frame.locator('[data-testid^="guest-item-"]').first()
    await expect(card, 'в показе нет ни одной карточки').toBeVisible({ timeout: 25_000 })
    const flat = await card.evaluate((node) => {
      const style = getComputedStyle(node)
      return `${style.backgroundColor}|${style.boxShadow}`
    })

    /*
      ПЕРЕКЛЮЧАЕМ НА ДРУГОЙ СТИЛЬ, А НЕ НА ТЕКУЩИЙ. У «Кристалла» в оформлении
      стоит «стекло», и нажатие на «стекло» ничего не меняло — проверка падала
      на исправном коде. Берём плоский: он заведомо отличается и от стекла, и
      от мягкого.
    */
    await page.getByTestId('brand-surface-flat').click()

    await expect
      .poll(
        async () =>
          card.evaluate((node) => {
            const style = getComputedStyle(node)
            return `${style.backgroundColor}|${style.boxShadow}`
          }),
        {
          timeout: 10_000,
          message: 'стиль поверхности сменили, а карточка осталась прежней',
        },
      )
      .not.toBe(flat)
  })
})
