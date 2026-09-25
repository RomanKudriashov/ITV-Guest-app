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

/**
 * ОДНО АКТИВНОЕ ПРАВИЛО НА ЗАВЕДЕНИЕ — СКАЗАНО ДО «СОХРАНИТЬ» (партия 20).
 *
 * Сервер держит это ограничение с самого начала, но узнавали о нём отказом
 * после заполнения формы, и отказ «уже есть активное правило» читается как
 * «второе правило завести нельзя вообще». Теперь занятое заведение называет
 * себя сразу и даёт ссылку на то правило, которое его заняло.
 */
test('занятое заведение говорит об этом при выборе, а не после отказа', async ({
  page,
  request,
}) => {
  const token = await apiToken(request)
  const rules = await (
    await request.get(`${API}/api/cms/escalation-rules`, { headers: apiHeaders(token) })
  ).json()
  const items = rules.items ?? rules
  /*
    Берём заведение с РОВНО ОДНИМ активным правилом. Двух через API не завести,
    но сид кладёт правила мимо API, и на стенде нашлась точка с двумя активными
    (СПА). На ней предупреждение не исчезнет и после перехода — оно там верное,
    и проверять им работу ссылки значит проверять состояние стенда.
  */
  const activeByPoint = new Map<string, number>()
  for (const rule of items) {
    if (!rule.is_active || !rule.execution_point_id) continue
    activeByPoint.set(
      rule.execution_point_id,
      (activeByPoint.get(rule.execution_point_id) ?? 0) + 1,
    )
  }
  const taken = items.find(
    (rule: { is_active: boolean; execution_point_id: string | null; name: string }) =>
      rule.is_active &&
      rule.execution_point_id &&
      rule.name &&
      activeByPoint.get(rule.execution_point_id) === 1,
  )
  test.skip(!taken, 'на стенде нет заведения ровно с одним активным правилом')

  await signInToCms(page)
  await page.goto('/cms/notifications')
  await page.getByTestId('cms-notifications-tab-escalation').click()
  await expect(page.getByTestId('cms-escalation-rules')).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('cms-escalation-new').click()
  // Пока заведение не выбрано, предупреждать не о чем.
  await expect(page.getByTestId('cms-escalation-point-taken')).toHaveCount(0)

  await page.selectOption('[data-testid="cms-escalation-point"]', taken.execution_point_id)

  const warning = page.getByTestId('cms-escalation-point-taken')
  await expect(warning, 'занятое заведение молчит до самого отказа сервера').toBeVisible({
    timeout: 10_000,
  })
  // Имя занявшего правила названо: иначе «уже есть» — это тупик без выхода.
  await expect(warning).toContainText(taken.name)

  // И выход есть: ссылка открывает то самое правило.
  await page.getByTestId('cms-escalation-point-taken-open').click()
  await expect(page.getByTestId('cms-escalation-heading')).toHaveText(taken.name)
  await expect(page.getByTestId('cms-escalation-point-taken')).toHaveCount(0)
})

test('свободное заведение не предупреждает ни о чём', async ({ page, request }) => {
  const token = await apiToken(request)
  const [rules, bootstrap] = await Promise.all([
    (await request.get(`${API}/api/cms/escalation-rules`, { headers: apiHeaders(token) })).json(),
    (await request.get(`${API}/api/cms/bootstrap`, { headers: apiHeaders(token) })).json(),
  ])
  const items = rules.items ?? rules
  const busy = new Set(
    items
      .filter((rule: { is_active: boolean }) => rule.is_active)
      .map((rule: { execution_point_id: string | null }) => rule.execution_point_id),
  )
  const free = (bootstrap.execution_points ?? []).find(
    (point: { id: string }) => !busy.has(point.id),
  )
  test.skip(!free, 'все заведения заняты активными правилами')

  await signInToCms(page)
  await page.goto('/cms/notifications')
  await page.getByTestId('cms-notifications-tab-escalation').click()
  await page.getByTestId('cms-escalation-new').click()
  await page.selectOption('[data-testid="cms-escalation-point"]', free.id)

  await expect(page.getByTestId('cms-escalation-point-taken')).toHaveCount(0)
})
