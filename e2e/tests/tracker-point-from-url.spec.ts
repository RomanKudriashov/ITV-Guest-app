import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, CREDENTIALS, login } from './helpers'

/**
 * ДОСКА ОТКРЫВАЕТСЯ НА ТОЙ ТОЧКЕ, КУДА ВЕДЁТ ССЫЛКА (бэклог, пункт 49).
 *
 * Пульт ведёт с карточки заведения на `/tracker?point=<код>`, а доска адрес не
 * читала: открывался сохранённый выбор или первая точка. На стенде владелец с
 * карточки «Консьерж» попадал на пустой «Лобби-бар» — и «пусто» читалось как
 * «заявок нет», хотя у консьержа лежала новая.
 *
 * Порядок: точка из адреса → сохранённый выбор → первая. Недоступная точка —
 * не молчаливая подмена, а «эта доска вам недоступна» и своя доска.
 */

const STORAGE_KEY = 'itv.tracker.point'

async function selectedPoint(page: Page): Promise<string> {
  return page.locator('[data-testid="tracker-point-select"] input').inputValue()
}

async function signIn(page: Page, credentials: { email: string; password: string }) {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(credentials.email)
  await page.getByTestId('login-password').fill(credentials.password)
  await page.getByTestId('login-submit').click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

test.describe('Доска: точка из адреса', () => {
  test('адрес сильнее сохранённого выбора и сам становится выбором', async ({ page }) => {
    await signIn(page, ADMIN)
    // Сохранённый выбор — бар: ровно то условие, при котором ссылка врала.
    await page.evaluate((key) => localStorage.setItem(key, 'bar'), STORAGE_KEY)

    await page.goto('/tracker?point=concierge')
    await expect.poll(() => selectedPoint(page), { timeout: 20_000 }).toBe('concierge')
    await expect(page.getByTestId('tracker-point-refused')).toHaveCount(0)
    // Параметр отработал и убран; выбор запомнен — обновление оставит консьержа.
    await expect(page).not.toHaveURL(/point=/)
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('concierge')
    await page.reload()
    await expect.poll(() => selectedPoint(page), { timeout: 20_000 }).toBe('concierge')
  })

  test('карточка заведения на пульте ведёт на доску этого заведения', async ({ page }) => {
    await login(page, ADMIN)
    await page.evaluate((key) => localStorage.setItem(key, 'bar'), STORAGE_KEY)
    await page.goto('/cms/dashboard')
    await page.getByTestId('dashboard-venue-concierge').click()
    await expect.poll(() => selectedPoint(page), { timeout: 20_000 }).toBe('concierge')
  })

  test('чужая или несуществующая точка — «недоступна» и своя доска, а не молчаливая подмена', async ({
    page,
  }) => {
    // Повар привязан только к кухне.
    await signIn(page, CREDENTIALS)
    for (const code of ['spa', 'no-such-point']) {
      await page.goto(`/tracker?point=${code}`)
      const notice = page.getByTestId('tracker-point-refused')
      await expect(notice, `точка ${code}`).toBeVisible({ timeout: 20_000 })
      await expect(notice).toContainText(/недоступна|not available/)
      await expect.poll(() => selectedPoint(page)).toBe('kitchen')
    }
  })
})
