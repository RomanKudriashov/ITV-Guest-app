import { expect, test } from './fixtures'

import { API, apiHeaders, apiToken, signInToCms } from './helpers'

/**
 * ВКЛАДКА «ПЕРЕДАЧА ВЫШЕ» — ТАБЛИЦА ПРАВИЛ (пункт 4 разбора).
 *
 * Было: выпадающий список, где видно одно имя за раз, и шапка «Правило
 * передачи выше» над каждым из них. Ответить на вопрос «что у нас вообще
 * настроено» можно было только перебрав список до конца.
 *
 * Стало: строка на правило со сводкой «кому и через сколько», имя правила в
 * заголовке карточки и предупреждение, когда доставлять некуда.
 */
test('правила показаны таблицей со сводкой ступеней', async ({ page, request }) => {
  const token = await apiToken(request)
  const rules = await (
    await request.get(`${API}/api/cms/escalation-rules`, { headers: apiHeaders(token) })
  ).json()
  const items = rules.items ?? rules
  expect(items.length, 'на стенде нет ни одного правила эскалации').toBeGreaterThan(0)

  await signInToCms(page)
  await page.goto('/cms/notifications')
  await page.getByTestId('cms-notifications-tab-escalation').click()

  const table = page.getByTestId('cms-escalation-rules')
  await expect(table, 'таблицы правил нет — остался выпадающий список').toBeVisible({
    timeout: 20_000,
  })
  await expect(page.locator('[data-testid^="cms-escalation-row-"]')).toHaveCount(items.length)

  // Сводка ступеней читается строкой: «через 10 мин → Старшему смены».
  const withSteps = items.find((rule: { steps?: unknown[] }) => (rule.steps ?? []).length > 0)
  if (withSteps) {
    await expect(page.getByTestId(`cms-escalation-steps-${withSteps.id}`)).toContainText(/мин/)
  }
})

test('заголовок карточки называет правило, которое правят', async ({ page, request }) => {
  const token = await apiToken(request)
  const rules = await (
    await request.get(`${API}/api/cms/escalation-rules`, { headers: apiHeaders(token) })
  ).json()
  const items = rules.items ?? rules
  const named = items.find((rule: { name: string }) => rule.name)
  test.skip(!named, 'все правила без имени — сравнивать нечего')

  await signInToCms(page)
  await page.goto('/cms/notifications')
  await page.getByTestId('cms-notifications-tab-escalation').click()
  await page.getByTestId(`cms-escalation-row-${named.id}`).click()

  await expect(page.getByTestId('cms-escalation-heading')).toHaveText(named.name)
})

test('правило, которому некуда доставлять, помечено', async ({ page, request }) => {
  const token = await apiToken(request)
  const channels = await (
    await request.get(`${API}/api/cms/notification-channels`, { headers: apiHeaders(token) })
  ).json()
  const active = (channels.items ?? channels).filter((c: { is_active: boolean }) => c.is_active)

  await signInToCms(page)
  await page.goto('/cms/notifications')
  await page.getByTestId('cms-notifications-tab-escalation').click()
  await expect(page.getByTestId('cms-escalation-rules')).toBeVisible({ timeout: 20_000 })

  // Нет ни одного активного канала — предупреждение на весь раздел: правила
  // сработают, а сообщение не уйдёт никуда.
  const banner = page.getByTestId('cms-escalation-no-channels')
  if (active.length === 0) {
    await expect(banner).toBeVisible()
  } else {
    await expect(banner).toHaveCount(0)
    // Каналы есть — значит каждая ступень, адресованная конкретному каналу,
    // обязана его найти. Значок предупреждения ставится ровно там, где не
    // находит.
    const rules = await (
      await request.get(`${API}/api/cms/escalation-rules`, { headers: apiHeaders(token) })
    ).json()
    const ids = new Set(active.map((c: { id: string }) => c.id))
    for (const rule of rules.items ?? rules) {
      const mute = (rule.steps ?? []).some(
        (step: { target_kind: string; channel_id?: string | null }) =>
          step.target_kind === 'channel' && !ids.has(step.channel_id ?? ''),
      )
      await expect(page.getByTestId(`cms-escalation-mute-${rule.id}`)).toHaveCount(mute ? 1 : 0)
    }
  }
})
