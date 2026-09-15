import { expect, test, type Page } from '@playwright/test'

import { ADMIN, signInToCms } from './helpers'

/*
  ПУБЛИКАЦИЯ ПО РАСПИСАНИЮ — ЧЕРЕЗ ИНТЕРФЕЙС.

  Проверяется то, ради чего заводили: назначенное ВИДНО (публикация, о которой
  знает только таблица, — сюрприз для утренней смены), время показано ПО ЧАСАМ
  ОТЕЛЯ с названным поясом, и отменить можно до срабатывания.

  Само срабатывание здесь не ждём: минимальный срок — минута, и держать прогон
  минуту ради того, что подробно проверено на сервере, незачем. Здесь — глаза
  оператора.

  После себя проверка прибирает: назначенное отменяется, черновики удаляются.
*/

async function openVersions(page: Page): Promise<void> {
  await signInToCms(page, ADMIN)
  await page.goto('/cms/brand')
  await expect(page.getByTestId('brand-editor')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('brand-tab-versions').click()
  await expect(page.getByTestId('brand-versions')).toBeVisible({ timeout: 15_000 })
}

async function dropDrafts(page: Page): Promise<void> {
  const empty = page.getByTestId('brand-drafts-empty')
  const rows = page.getByTestId('brand-draft-delete')
  await expect
    .poll(async () => (await empty.count()) + (await rows.count()), { timeout: 15_000 })
    .toBeGreaterThan(0)

  while ((await rows.count()) > 0) {
    const before = await rows.count()
    await rows.first().click()
    await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeLessThan(before)
  }
}

async function dropSchedule(page: Page): Promise<void> {
  /*
    СНАЧАЛА ДОЖДАТЬСЯ СПИСКА, ПОТОМ УБИРАТЬ.

    Список приезжает запросом, и пустой экран в первый миг означает «ещё не
    загрузилось», а не «назначенного нет». Уборка, начатая раньше, ничего не
    находит — и оставшаяся строка достаётся следующей проверке как чужое
    состояние стенда. Ровно тот класс, за который уже платили.
  */
  const empty = page.getByTestId('brand-schedule-empty')
  const rows = page.getByTestId('brand-schedule-row')
  await expect
    .poll(async () => (await empty.count()) + (await rows.count()), { timeout: 15_000 })
    .toBeGreaterThan(0)

  while ((await rows.count()) > 0) {
    const before = await rows.count()
    await page.getByTestId('brand-schedule-cancel').first().click()
    await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeLessThan(before)
  }
}

/** Завтрашние три ночи — в форме, которую принимает поле `datetime-local`. */
function tomorrowNight(): string {
  const at = new Date()
  at.setDate(at.getDate() + 1)
  at.setHours(3, 0, 0, 0)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T03:00`
}

test.describe('Публикация по расписанию', () => {
  test('назначенное видно, названо временем отеля и отменяется', async ({ page }) => {
    await openVersions(page)
    await dropSchedule(page)
    await dropDrafts(page)

    const name = `К Новому году ${Date.now()}`
    await page.getByTestId('brand-draft-name').fill(name)
    await page.getByTestId('brand-draft-save').click()
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('brand-draft-schedule').first().click()
    await page.getByTestId('brand-schedule-when').fill(tomorrowNight())
    await page.getByTestId('brand-schedule-confirm').click()

    // НАЗНАЧЕННОЕ ВИДНО — со временем, поясом и тем, кто назначил.
    const row = page.getByTestId('brand-schedule-row').filter({ hasText: name })
    await expect(row, 'назначенной публикации не видно').toBeVisible({ timeout: 15_000 })
    await expect(row).toContainText(name)
    await expect(row, 'не назван часовой пояс отеля').toContainText(/[A-Za-z]+\/[A-Za-z_]+|UTC/)

    // ОТМЕНИТЬ МОЖНО до срабатывания.
    //
    // Утверждаем про СВОЮ строку, а не про пустоту всего списка: у отеля может
    // быть назначено что-то ещё, и требовать пустоты значит требовать, чтобы
    // стенд принадлежал только этой проверке.
    await row.getByTestId('brand-schedule-cancel').click()
    await expect(row, 'отменённая публикация осталась в списке').toHaveCount(0, {
      timeout: 15_000,
    })

    await dropDrafts(page)
  })

  test('время в прошлом не принимается', async ({ page }) => {
    await openVersions(page)
    await dropSchedule(page)
    await dropDrafts(page)

    const name = `Прошлое ${Date.now()}`
    await page.getByTestId('brand-draft-name').fill(name)
    await page.getByTestId('brand-draft-save').click()
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('brand-draft-schedule').first().click()
    await page.getByTestId('brand-schedule-when').fill('2020-01-01T03:00')
    await page.getByTestId('brand-schedule-confirm').click()

    // Отказ сказан словами, а не проглочен: иначе оператор уйдёт уверенным, что
    // публикация назначена.
    await expect(page.getByTestId('brand-versions-error')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('brand-schedule-empty')).toBeVisible()

    await dropDrafts(page)
  })
})
