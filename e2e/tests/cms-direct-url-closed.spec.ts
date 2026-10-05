import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { CREDENTIALS, signIn } from './helpers'

/**
 * ПРЯМОЙ АДРЕС ЗАКРЫТОГО РАЗДЕЛА — ОДНО ПОНЯТНОЕ СОСТОЯНИЕ (партия 31, DEV-07 QA).
 *
 * QA: повар на /admin/settings получал до 12 ответов 403 в консоли,
 * управляющая СПА — полуживые «Настройки» с «Не удалось загрузить». Право на
 * раздел знает сервер (`/cms/navigation`); экран раздела не монтируется, пока
 * ответа нет, и не монтируется вовсе, если раздела в ответе нет.
 */

const SPA_MANAGER = { email: 'manager.spa@crystal.local', password: 'chef12345' }

async function openCounting403(page: Page, path: string): Promise<string[]> {
  const refused: string[] = []
  page.on('response', (response) => {
    if (response.status() === 403 && response.url().includes('/api/')) refused.push(new URL(response.url()).pathname)
  })
  await page.goto(path)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1500)
  return refused
}

test('повар на «Настройках» по прямому адресу — отказ без каскада 403', async ({ page }) => {
  await signIn(page, CREDENTIALS)
  const refused = await openCounting403(page, '/cms/settings')
  await expect(page.getByTestId('cms-no-access')).toBeVisible()
  // Единственный ожидаемый отказ — сам вопрос «какие разделы мне открыты».
  expect(refused, 'запросы в закрытые ручки после отказа').toEqual(['/api/v1/cms/navigation'])
})

test('управляющая СПА на «Настройках» — «раздел закрыт», а не полуживой экран', async ({ page }) => {
  await signIn(page, SPA_MANAGER)
  const refused = await openCounting403(page, '/cms/settings')
  await expect(page.getByTestId('cms-section-closed')).toBeVisible()
  await expect(page.getByText('Не удалось загрузить')).toHaveCount(0)
  expect(refused, 'запросы в закрытые ручки').toEqual([])
  // Свой раздел открывается как прежде.
  await page.getByTestId('section-closed-home').click()
  await expect(page.getByTestId('cms-section-closed')).toHaveCount(0)
})

test('администратор на модульном разделе без модуля — экран раздела, а не «раздел закрыт»', async ({ page }) => {
  // Модульный пункт меню появляется только с модулем, но маршрут живёт всегда
  // и сам объясняет, что модуль выключен. Охрана по роли его не закрывает.
  await signIn(page)
  await page.goto('/cms/marketing')
  await expect(page.getByTestId('cms-page-title').or(page.locator('main h5')).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('cms-section-closed')).toHaveCount(0)
})
