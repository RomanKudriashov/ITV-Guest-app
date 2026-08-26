import { expect, test, type Page } from '@playwright/test'

import { PLATFORM } from './helpers'

/**
 * ЭКРАН ПУБЛИКАЦИИ.
 *
 * Машина проверена на сервере (`backend/tests/hotels/test_publication.py`).
 * Здесь — то, чего в ней не видно: показывает ли экран ХОД операции, пока она
 * идёт, и различает ли он отказ отеля и нашу ошибку.
 *
 * ОТВЕТЫ ПОДМЕНЯЮТСЯ. Настоящая публикация на стенде из пятнадцати отелей
 * заканчивается быстрее, чем человек успевает посмотреть на полосу хода: ловить
 * это гонкой значило бы получить тест, который краснеет через раз. Подменяем
 * ответ сервера — проверяется ровно экран, а не скорость воркера.
 */

const RUNNING = {
  id: 'job-1',
  kind: 'badge',
  description: 'бейдж «Осенний хит»',
  scope: 'group',
  group: 'Москва',
  actor: 'Владелец платформы',
  status: 'running',
  planned: 47,
  error: '',
  created_at: new Date().toISOString(),
  finished_at: null,
  counts: { applied: 12 },
  pending: 35,
  results: [],
}

const DONE = {
  ...RUNNING,
  status: 'done',
  finished_at: new Date().toISOString(),
  counts: { applied: 44, skipped: 1, refused: 1, failed: 1 },
  pending: 0,
  results: [
    { hotel_id: '1', subdomain: 'alpha', name: 'Alpha', outcome: 'applied', detail: 'заведён', reason: '' },
    {
      hotel_id: '2', subdomain: 'beta', name: 'Beta', outcome: 'skipped',
      detail: 'у отеля своя правка этого бейджа — публикация её не трогает', reason: 'local_edit',
    },
    {
      hotel_id: '3', subdomain: 'gamma', name: 'Gamma', outcome: 'refused',
      detail: 'модуль «Маркетинг» не подключён', reason: 'module_off',
    },
    {
      hotel_id: '4', subdomain: 'delta', name: 'Delta', outcome: 'failed',
      detail: 'RuntimeError: соединение с базой отеля потеряно', reason: 'exception',
    },
  ],
}

async function login(page: Page): Promise<void> {
  await page.goto('/admin')
  await page.evaluate(() => window.localStorage.clear())
  await page.goto('/admin')
  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 30_000 })
}

test('УКУС: пока операция идёт — виден ход; отказ и ошибка показаны порознь', async ({ page }) => {
  await login(page)

  // Сначала операция «идёт»: экран обязан показать, сколько отчиталось.
  let phase = RUNNING
  await page.route('**/api/v1/platform/publications/job-1', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(phase) })
  })
  await page.route('**/api/v1/platform/publications', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ items: [phase] }),
      })
      return
    }
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(RUNNING) })
  })

  await page.goto('/admin?section=publications')
  await expect(page.getByTestId('admin-publications')).toBeVisible({ timeout: 20_000 })

  // Открываем идущую операцию из истории.
  await page.getByTestId('admin-pub-history-job-1').click()
  await expect(page.getByTestId('admin-pub-progress')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('admin-pub-progress')).toContainText('12')
  await expect(page.getByTestId('admin-pub-progress')).toContainText('47')

  // Операция завершилась — экран догоняет сам, без перезагрузки.
  phase = DONE as typeof RUNNING
  await expect(page.getByTestId('admin-pub-status')).toContainText('Завершена', { timeout: 20_000 })
  await expect(page.getByTestId('admin-pub-progress')).toHaveCount(0)

  // ОТКАЗ И ОШИБКА — РАЗНЫЕ НОВОСТИ: два разных счётчика, а не один «не вышло».
  await expect(page.getByTestId('admin-pub-outcome-refused')).toBeVisible()
  await expect(page.getByTestId('admin-pub-outcome-failed')).toBeVisible()

  await page.getByTestId('admin-pub-outcome-refused').click()
  await expect(page.getByTestId('admin-pub-list-refused')).toContainText('gamma')
  await expect(page.getByTestId('admin-pub-list-refused')).toContainText('Маркетинг')

  await page.getByTestId('admin-pub-outcome-failed').click()
  await expect(page.getByTestId('admin-pub-list-failed')).toContainText('delta')
  await expect(page.getByTestId('admin-pub-list-failed')).toContainText('RuntimeError')

  // Пропущенные из-за локальной правки — отдельным списком, с переходом на
  // расхождения: «пропущено» без этого разделения означало бы две разные
  // новости одним числом.
  await expect(page.getByTestId('admin-pub-local-edits')).toContainText('beta')
  await expect(page.getByTestId('admin-pub-to-divergence')).toBeVisible()
})
