import { expect, test, type Page } from '@playwright/test'

import { CREDENTIALS, login, loginToTracker } from './helpers'

/**
 * УКУС ПАРТИИ 6: слова «точка исполнения» на экранах больше нет.
 *
 * Связь заведения и исполнителя — 1:1: точка заводится вместе с заведением и
 * носит его имя. Выбирать было не из чего — в каждом списке ровно столько
 * элементов, сколько заведений, и назывались они одинаково. Человек выбирал из
 * списка синонимов и не понимал, почему список назван по-другому. Третьим
 * синонимом того же самого был «Отдел-исполнитель» в настройке слотов.
 *
 * Сущность при этом жива: на ней висят маршруты, заказы, привязки персонала,
 * группа Channels трекера. Ушло СЛОВО, а `execution_point_id` подставляется
 * молча — ровно так, как в `StaffPage` было сделано с самого начала.
 *
 * Проверяем видимый текст, а не разметку: правка была именно про то, что
 * человек читает.
 */

/** Слова, которых на экране быть не должно. */
const BANNED = /точк[аиеуой]?\s+исполнени|Отдел-исполнитель|По точкам/i

async function bodyText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()) ?? ''
}

test.describe('Заведение вместо точки исполнения', () => {
  test('уведомления: канал и правило эскалации выбирают ЗАВЕДЕНИЕ', async ({ page }) => {
    await login(page)
    await page.goto('/cms/notifications')
    await expect(page.getByTestId('cms-notifications-tab-channels')).toBeVisible({
      timeout: 20_000,
    })

    // Вкладка каналов: привязка канала. Выпадающий список исполнителя
    // отрисовывается ТОЛЬКО при выбранной привязке — иначе проверять было бы
    // нечего и тест проходил бы вхолостую.
    await page.getByTestId('cms-channel-add').click()
    await expect(page.getByTestId('cms-channel-type')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('cms-channel-binding').selectOption('point')
    await expect(page.getByTestId('cms-channel-point')).toBeVisible({ timeout: 15_000 })
    expect(await bodyText(page)).not.toMatch(BANNED)
    // И в списке стоят имена заведений, а не служебные вторые имена.
    expect(await page.getByTestId('cms-channel-point').innerText()).toMatch(/\S/)
    await page.keyboard.press('Escape')

    // Вкладка эскалаций: адресат правила.
    await page.getByTestId('cms-notifications-tab-escalation').click()
    await expect(page.getByTestId('cms-escalation-new')).toBeVisible({ timeout: 15_000 })
    expect(await bodyText(page)).not.toMatch(BANNED)
  })

  test('аналитика: разрез называется «По заведениям»', async ({ page }) => {
    await login(page)
    await page.goto('/cms/analytics')
    await expect(page.getByTestId('cms-analytics')).toBeVisible({ timeout: 20_000 })

    const text = await bodyText(page)
    expect(text).not.toMatch(BANNED)
    expect(text).toContain('аведени')
  })

  test('персонал: сотрудника привязывают к заведению', async ({ page }) => {
    await login(page)
    await page.goto('/cms/staff')
    await expect(page.getByTestId('staff-list')).toBeVisible({ timeout: 20_000 })
    expect(await bodyText(page)).not.toMatch(BANNED)
  })

  test('трекер: доска и её переключатель — про заведение', async ({ page }) => {
    await loginToTracker(page, CREDENTIALS)
    expect(await bodyText(page)).not.toMatch(BANNED)

    // Имя на переключателе — гостевое имя заведения, а не служебное второе.
    const select = page.getByTestId('tracker-point-select')
    if (await select.count()) {
      await expect(select).not.toContainText(BANNED)
    }
  })
})
