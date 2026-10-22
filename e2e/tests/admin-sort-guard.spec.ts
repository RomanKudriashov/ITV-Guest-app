import { type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, PLATFORM, signInPlatform } from './helpers'

/**
 * СТОРОЖ СОРТИРОВКИ В CONTROL (партия 62-F).
 *
 * Таблицы: у каждого заголовка — либо кнопка сортировки (`data-sort-key`),
 * либо явная пометка «не сортируется» (`data-sort="none"`: флажки, действия).
 * Каждый сортируемый столбец: щелчок — ↑ (`aria-sort="ascending"`, `sort` и
 * `dir` в адресе), ещё раз — ↓, третий — сброс; порядок строк при ↑ и ↓
 * разный, если значения столбца не все одинаковы.
 *
 * Списки без заголовков: «Сортировать по» есть, выбор пишет `sort`/`dir` в
 * адрес, ссылка открывает тот же порядок.
 *
 * Стенд не меняется: только чтение и щелчки по заголовкам.
 */

async function crystalId(request: APIRequestContext): Promise<string> {
  const access = (await (await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })).json()).access
  const fleet = await (await request.get(`${API}/api/v1/platform/fleet?search=crystal&origin=all`, { headers: { Authorization: `Bearer ${access}` } })).json()
  return (fleet.items as { id: string; subdomain: string }[]).find((row) => row.subdomain === 'crystal')!.id
}

const rowsOf = (table: Locator) => table.locator('tbody > tr')

async function rowTexts(table: Locator): Promise<string[]> {
  return rowsOf(table).evaluateAll((rows) => rows.map((row) => (row as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))
}

async function columnTexts(table: Locator, index: number): Promise<string[]> {
  return rowsOf(table).evaluateAll(
    (rows, i) => rows.map((row) => ((row as HTMLTableRowElement).cells[i]?.innerText ?? '').replace(/\s+/g, ' ').trim()),
    index,
  )
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.waitForTimeout(600)
}

async function checkTables(page: Page, screen: string, report: string[]) {
  const tables = page.locator('main table')
  const count = await tables.count()
  expect(count, `${screen}: таблиц нет — проверять нечего`).toBeGreaterThan(0)
  for (let ti = 0; ti < count; ti += 1) {
    const table = tables.nth(ti)
    const headers = table.locator('thead th')
    const n = await headers.count()
    for (let hi = 0; hi < n; hi += 1) {
      const th = headers.nth(hi)
      const key = await th.getAttribute('data-sort-key')
      const none = await th.getAttribute('data-sort')
      expect(Boolean(key) || none === 'none', `${screen}: столбец ${hi + 1} без сортировки и без пометки «не сортируется»`).toBeTruthy()
      if (!key) continue
      const button = th.getByRole('button').first()
      const values = await columnTexts(table, hi)
      await button.click()
      await settle(page)
      await expect(table.locator('thead th').nth(hi)).toHaveAttribute('aria-sort', 'ascending')
      await expect(page).toHaveURL(new RegExp(`sort=${key}`))
      const up = await rowTexts(table)
      await table.locator('thead th').nth(hi).getByRole('button').first().click()
      await settle(page)
      await expect(table.locator('thead th').nth(hi)).toHaveAttribute('aria-sort', 'descending')
      await expect(page).toHaveURL(/dir=desc/)
      const down = await rowTexts(table)
      const distinct = new Set(values.filter(Boolean)).size
      if (up.length > 1 && distinct > 1) {
        expect(down, `${screen}: «${key}» — ↑ и ↓ дают один порядок`).not.toEqual(up)
      } else {
        report.push(`${screen}: «${key}» — значения одинаковы или строк меньше двух, порядок не проверить`)
      }
      await table.locator('thead th').nth(hi).getByRole('button').first().click()
      await settle(page)
      await expect(table.locator('thead th').nth(hi)).toHaveAttribute('aria-sort', 'none')
      await expect(page).not.toHaveURL(new RegExp(`[?&]sort=${key}`))
    }
  }
}

test.describe('Control: сортировка таблиц', () => {
  test('каждый столбец сортируется ↑ ↓ сброс и меняет порядок', async ({ page, request }) => {
    test.setTimeout(8 * 60_000)
    const id = await crystalId(request)
    await signInPlatform(page, PLATFORM)
    const report: string[] = []
    const screens: Array<[string, string]> = [
      ['Отели списком', '/admin?section=fleet&layout=list&origin=all'],
      ['Модули таблицей', '/admin?section=modules&view=table'],
      ['Команда', '/admin?section=team'],
      ['Номерной фонд', `/admin?section=fleet&hotel=${id}&tab=rooms`],
      ['Журнал оборудования', `/admin?section=fleet&hotel=${id}&tab=journal`],
      ['Версии', `/admin?section=fleet&hotel=${id}&tab=roomControl&sub=versions`],
      ['Конструктор: переменные', `/admin?section=fleet&hotel=${id}&tab=roomControl&sub=builder`],
    ]
    for (const [screen, url] of screens) {
      await page.goto(url)
      await expect(page.locator('main table').first()).toBeVisible({ timeout: 30_000 })
      await settle(page)
      await checkTables(page, screen, report)
    }
    console.log(report.join('\n') || 'все столбцы меняют порядок')
  })

  test('ссылка с сортировкой открывает тот же порядок', async ({ page }) => {
    await signInPlatform(page, PLATFORM)
    await page.goto('/admin?section=fleet&layout=list&origin=all&sort=rooms&dir=desc')
    const th = page.locator('main table thead th[data-sort-key="rooms"]')
    await expect(th).toHaveAttribute('aria-sort', 'descending', { timeout: 30_000 })
    const rooms = await page.locator('[data-testid^="admin-fleet-rooms-"]').allInnerTexts()
    const numbers = rooms.map(Number)
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a))
  })
})

test.describe('Control: «Сортировать по» в списках', () => {
  test('выбор пишет столбец в адрес, сброс — убирает', async ({ page, request }) => {
    test.setTimeout(6 * 60_000)
    const id = await crystalId(request)
    await signInPlatform(page, PLATFORM)
    const lists: Array<[string, string, string]> = [
      ['Модули блоками', '/admin?section=modules', 'admin-modules-sort-bar'],
      ['Журнал действий', '/admin?section=audit', 'admin-audit-sort'],
      ['Входы поддержки', '/admin?section=audit&view=support', 'admin-support-sort'],
      ['Шаблоны', '/admin?section=templates', 'admin-templates-sort'],
      ['Безопасность', '/admin?section=security', 'sessions-sort'],
      ['Модули отеля', `/admin?section=fleet&hotel=${id}&tab=modules`, 'admin-hotel-modules-sort'],
      ['Подключения', `/admin?section=fleet&hotel=${id}&tab=connections`, 'admin-nodes-sort'],
      ['История', `/admin?section=fleet&hotel=${id}&tab=history`, 'admin-history-sort'],
      ['Карточка модуля', '/admin?section=modules&module=marketing', 'admin-module-hotels-sort'],
    ]
    for (const [name, url, testId] of lists) {
      await page.goto(url)
      const bar = page.getByTestId(testId)
      await expect(bar, `${name}: нет «Сортировать по»`).toBeVisible({ timeout: 30_000 })
      await bar.click()
      const options = page.getByRole('option')
      await expect(options.nth(2)).toBeVisible()
      await options.nth(2).click() // первый столбец, ↓
      await expect(page, name).toHaveURL(/sort=[a-z_]+.*dir=desc|dir=desc.*sort=[a-z_]+/)
      await page.reload()
      // Выбранное «Сортировать по» — значение поля, не его текст.
      await expect(page.getByTestId(testId), `${name}: после F5`).toBeVisible({ timeout: 30_000 })
      await expect(page).toHaveURL(/dir=desc/)
      const shown = await page.getByTestId(testId).evaluate((el) => (el as HTMLInputElement).value ?? el.textContent ?? '')
      expect(shown, `${name}: после F5 выбор потерялся`).toContain('↓')
      await page.getByTestId(testId).click()
      await page.getByRole('option').first().click() // по умолчанию
      await expect(page, name).not.toHaveURL(/[?&](j|s|d)?sort=/)
    }
  })
})
