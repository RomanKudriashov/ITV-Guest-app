import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, PLATFORM, signIn } from './helpers'

/**
 * НИЖНИЙ ПОЛ ОФОРМЛЕНИЯ (партия 55): то, что аудит нашёл сотнями копий одной
 * ошибки темы или общего компонента. Проверка — замером, а не наличием:
 *   — текст третьего уровня и акцент как текст — ≥ 4.5:1 на своём фоне в
 *     обеих темах (было 3.81 и 4.12 у подписей групп меню, 2.63 у активного
 *     пункта меню в тёмной теме);
 *   — значение в поле языка шапки видно целиком (было «Русск…» на всех
 *     экранах — регрессия партии 54);
 *   — многовыбор ростом с соседнее поле (было 45 px против 32).
 */

const ROOT_PORT = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5183').port || '5183'
const ROOT = `http://guest.localhost:${ROOT_PORT}`

/** Контраст текста элемента к сплошному фону под ним (WCAG). */
async function contrastOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const parse = (c: string) => {
      const p = (c.match(/rgba?\(([^)]+)\)/)?.[1] ?? '0,0,0').split(/[ ,/]+/).filter(Boolean).map(Number)
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
    }
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 }
    for (let n: Element | null = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c.a >= 1) {
        bg = c
        break
      }
    }
    const fg = parse(getComputedStyle(el).color)
    const mixed = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) }
    const [a, b] = [lum(mixed), lum(bg)]
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  })
}

for (const mode of ['light', 'dark'] as const) {
  test(`CMS, ${mode}: подписи групп меню и активный пункт — не ниже 4.5:1`, async ({ page }) => {
    await page.addInitScript((m) => window.localStorage.setItem('itv.theme-mode', m), mode)
    await signIn(page, ADMIN)
    await page.goto('/cms/dashboard')
    await expect(page.getByTestId('cms-nav-dashboard')).toBeVisible({ timeout: 20_000 })
    // Сама подпись, а не контейнер группы: у контейнера основной цвет текста.
    const group = await contrastOf(page, '[data-testid="nav-group-operations"] .MuiTypography-overline')
    expect(group, 'подпись группы меню').toBeGreaterThanOrEqual(4.5)
    // Мы на сводке — её пункт активен; текст пункта — абзац внутри ссылки.
    const active = await contrastOf(page, '[data-testid="cms-nav-dashboard"] p')
    expect(active, 'активный пункт меню').toBeGreaterThanOrEqual(4.5)
  })
}

for (const width of [1440, 390]) {
  test(`шапка ${width}: значение в поле языка видно целиком`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await signIn(page, ADMIN)
    await page.goto('/cms/dashboard')
    const field = page.getByTestId('language-switcher')
    await expect(field).toHaveValue('Русский', { timeout: 20_000 })
    const fit = await field.evaluate((input: HTMLInputElement) => input.scrollWidth - input.clientWidth)
    expect(fit, '«Русский» обрезан в поле языка').toBeLessThanOrEqual(1)
  })
}

test('многовыбор ростом с соседнее поле («Новый отель»: «Валюта» и «Языки»)', async ({ page }) => {
  await page.goto(`${ROOT}/admin`)
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 30_000 })
  await page.goto(`${ROOT}/admin?section=fleet`)
  await page.getByTestId('admin-create-open').click()
  await expect(page.getByTestId('admin-create-languages')).toBeVisible({ timeout: 15_000 })
  const [currency, languages] = await Promise.all(
    ['admin-create-currency', 'admin-create-languages'].map((id) =>
      page.getByTestId(id).evaluate((el) => el.closest('.MuiInputBase-root')!.getBoundingClientRect().height),
    ),
  )
  expect(Math.abs(languages - currency), `«Языки» ${languages} px против «Валюты» ${currency} px`).toBeLessThanOrEqual(1)
})
