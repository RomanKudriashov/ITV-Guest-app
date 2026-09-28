import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { login } from './helpers'

/**
 * «НИЧЕГО НЕ НАЙДЕНО» ≠ «ПОКА ПУСТО» (ADM-003 внешнего аудита).
 *
 * Поиск сотрудника без результата показывал «Пока нет сотрудников» и кнопку
 * «Добавить сотрудника» — при тринадцати живых сотрудниках. Неправда на экране
 * и прямая подсказка завести дубль. Той же болезнью болел «Номерной фонд»:
 * там `isFiltered` был посчитан, но пустая ветка его не читала.
 *
 * Проверяем по ТЕКСТУ и по кнопке — тому, что читает человек: testid у двух
 * состояний один (`ListEmpty`), различаются они смыслом.
 */

const NO_SUCH = '__no_such_🚫__'

async function searchFor(page: Page, section: 'staff' | 'rooms', searchTestId: string) {
  await login(page)
  await page.getByTestId(`cms-nav-${section}`).click()
  await expect(page.getByTestId(`${section}-list`)).toBeVisible({ timeout: 20_000 })
  await page.getByTestId(searchTestId).fill(NO_SUCH)
}

test.describe('Пустота под поиском — «ничего не найдено», а не «пока нет»', () => {
  test('персонал: поиск без результата предлагает сбросить поиск, а не добавить', async ({ page }) => {
    await searchFor(page, 'staff', 'staff-search')

    const empty = page.getByTestId('staff-empty')
    await expect(empty).toContainText(/По запросу ничего не найдено|Nothing matches your search/, {
      timeout: 15_000,
    })
    await expect(empty).not.toContainText(/Пока нет сотрудников|No staff yet/)
    await expect(empty.getByRole('button', { name: /Добавить|Add/ })).toHaveCount(0)

    await empty.getByTestId('list-reset-filters').click()
    await expect(page.getByTestId('staff-search')).toHaveValue('')
    await expect(page.getByTestId('staff-list')).toBeVisible()
  })

  test('номерной фонд: то же самое', async ({ page }) => {
    await login(page)
    await page.getByTestId('cms-nav-rooms').click()
    // Список, а не сетка: пустота под поиском — у списка, сетка гасит кубики.
    await page.goto('/cms/rooms?view=list')
    await expect(page.getByTestId('rooms-list')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('rooms-search').fill(NO_SUCH)

    const empty = page.getByTestId('rooms-empty')
    await expect(empty).toContainText(/По запросу ничего не найдено|Nothing matches your search/, {
      timeout: 15_000,
    })
    await expect(empty.getByRole('button', { name: /Добавить|Add/ })).toHaveCount(0)
    await empty.getByTestId('list-reset-filters').click()
    await expect(page.getByTestId('rooms-list')).toBeVisible()
  })
})
