import { expect, test } from './fixtures'

import { API, HOTEL, apiToken, signInToCms, unique } from './helpers'

/**
 * ДВЕ ДЫРЫ В НАБОРЕ, ЗАКРЫТЫЕ ЗДЕСЬ.
 *
 * 1. ВКЛАДКУ «ЖУРНАЛ» НЕ ОТКРЫВАЛ НИ ОДИН ТЕСТ. Она падала с
 *    `TypeError: entries is not iterable` при первом же открытии: выдача
 *    приезжает конвертом `{items, total, …}`, а клиент отдавал объект прямо в
 *    группировку. Экран не открывался вовсе — и никто об этом не знал, потому
 *    что смотреть было некому.
 *
 * 2. ВТОРОЕ ПРАВИЛО ЭСКАЛАЦИИ НЕЛЬЗЯ БЫЛО СОЗДАТЬ ЧЕРЕЗ ИНТЕРФЕЙС. Эффект
 *    вкладки возвращал выбор с «Новое правило» на первое существующее всякий
 *    раз, когда правил хотя бы одно: и пункт списка, и кнопка «+» откатывались
 *    обратно. Правило заводилось только запросом мимо экрана — а проверялось
 *    ровно так же, запросом, поэтому набор молчал.
 */

test.describe('Уведомления: журнал и второе правило', () => {
  test('вкладка «Журнал» открывается, показывает записи и фильтрует по номеру', async ({
    page,
    request,
  }) => {
    const token = await apiToken(request)
    const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }

    // Записи в журнале на стенде есть — иначе проверять «показывает записи»
    // нечем, и это состояние стенда, а не молчаливый пропуск.
    const log = await request.get(`${API}/api/cms/notification-log?limit=5`, { headers })
    expect(log.status(), await log.text()).toBe(200)
    const entries = (await log.json()).items as Array<{ order_number: number }>
    expect(entries.length, 'в журнале стенда нет ни одной записи').toBeGreaterThan(0)

    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(String(error)))

    await signInToCms(page)
    await page.goto('/cms/notifications')
    await page.getByTestId('cms-notifications-tab-log').click()

    // Таблица, а не пустое состояние и не белый экран.
    await expect(page.getByTestId('cms-notification-log')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('cms-log-row-0')).toBeVisible()
    expect(errors, `вкладка упала: ${errors.join(' | ')}`).toEqual([])

    // Фильтр принимает ТО, ЧТО НАПИСАНО В ТАБЛИЦЕ, — номер заказа.
    const number = String(entries[0].order_number)
    await expect(page.getByTestId('cms-log-row-0')).toContainText('№')
    await page.getByTestId('cms-log-order-filter').fill(number)

    await expect(page.getByTestId('cms-notification-log')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('cms-log-row-0')).toContainText(`№${number}`)
    // И в отфильтрованной таблице нет ЧУЖИХ заказов.
    const shown = await page.getByTestId('cms-notification-log').innerText()
    const otherNumbers = [...shown.matchAll(/№(\d+)/g)].map((m) => m[1])
    expect(new Set(otherNumbers), `в выдаче по №${number} чужие заказы`).toEqual(new Set([number]))
    expect(errors, `вкладка упала после фильтра: ${errors.join(' | ')}`).toEqual([])

    // И «не нашли по фильтру» — ОТДЕЛЬНЫЙ ответ, а не «записей пока нет».
    // Вторая фраза утверждает, что уведомлений в отеле не было вовсе, и по ней
    // решают, не сломались ли уведомления.
    await page.getByTestId('cms-log-order-filter').fill('999999999')
    await expect(page.getByTestId('cms-log-nothing-found')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('cms-log-empty')).toHaveCount(0)
  })

  test('второе правило эскалации создаётся через интерфейс', async ({ page, request }) => {
    const token = await apiToken(request)
    const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }

    const before = await request.get(`${API}/api/cms/escalation-rules`, { headers })
    const existing = (await before.json()).items as Array<{ id: string; execution_point_id: string }>
    expect(
      existing.length,
      'правил нет вовсе — тогда «второе» проверять не на чем: экран и так начинает с пустой формы',
    ).toBeGreaterThan(0)

    // Точка, на которой правила ЕЩЁ НЕТ: активное правило на точку одно.
    const points = await request.get(`${API}/api/cms/bootstrap`, { headers })
    const taken = new Set(existing.map((rule) => rule.execution_point_id))
    const free = ((await points.json()).execution_points as Array<{ id: string; code: string }>).find(
      (point) => !taken.has(point.id),
    )
    expect(free, 'у всех заведений уже есть правило — свободной точки нет').toBeTruthy()

    await signInToCms(page)
    await page.goto('/cms/notifications')
    await page.getByTestId('cms-notifications-tab-escalation').click()
    await expect(page.getByTestId('cms-escalation-new')).toBeVisible({ timeout: 20_000 })

    // Кнопка «+ Новое правило» обязана ОСТАВИТЬ выбор на новом правиле.
    // Выбор больше не в выпадающем списке: правила показаны таблицей, а то,
    // что сейчас правят, названо в заголовке карточки.
    await page.getByTestId('cms-escalation-new').click()
    await expect(page.getByTestId('cms-escalation-heading')).toHaveText('Новое правило')
    // Имя пустое — значит открыта пустая форма, а не чужое правило.
    await expect(page.getByTestId('cms-escalation-name')).toHaveValue('')

    const name = `Правило ${unique('esc')}`
    await page.getByTestId('cms-escalation-name').fill(name)
    await page.getByTestId('cms-escalation-point').selectOption(free!.id)
    // Пустая форма приходит С ОДНОЙ ступенью — добавлять вторую здесь незачем,
    // и вторая с той же задержкой была бы ошибкой формы, а не проверкой.
    await expect(page.getByTestId('cms-step-0')).toBeVisible()
    await expect(page.getByTestId('cms-step-1')).toHaveCount(0)
    await page.getByTestId('cms-step-delay-0').fill('5')
    await page.getByTestId('cms-step-target-0').selectOption('point')
    await page.getByTestId('cms-escalation-save').click()

    // Правда — на сервере, и правило принадлежит выбранной точке.
    let created: { id: string; execution_point_id: string; steps: unknown[] } | undefined
    await expect
      .poll(
        async () => {
          const list = await request.get(`${API}/api/cms/escalation-rules`, { headers })
          created = ((await list.json()).items as typeof existing as never[]).find(
            (rule: { name: string }) => rule.name === name,
          )
          return Boolean(created)
        },
        { timeout: 15_000 },
      )
      .toBe(true)
    expect(created!.execution_point_id).toBe(free!.id)
    expect(created!.steps).toHaveLength(1)

    await request.delete(`${API}/api/cms/escalation-rules/${created!.id}`, { headers })
  })
})

/**
 * `logged` КРАСНЫМ У УСПЕШНОЙ СТРОКИ (партия 20, хвост пункта 5).
 *
 * Сервер кладёт в поле `error` две разные вещи: текст ошибки, когда отправка не
 * удалась, и ОТВЕТ КАНАЛА, когда удалась (`logged` у лог-канала, идентификатор
 * письма у почты). Журнал показывал поле одной колонкой «Ошибка» и красным —
 * рядом с зелёным «Отправлено» горело красное `logged`, и читалось это как
 * «ушло, но что-то сломалось».
 */
test('у успешной строки журнала «Ошибка» пуста, а ответ канала — не красный', async ({
  page,
  request,
}) => {
  const token = await apiToken(request)
  const headers = { Authorization: `Bearer ${token}`, 'X-Hotel-Subdomain': HOTEL }
  const log = await request.get(`${API}/api/cms/notification-log?limit=100`, { headers })
  const entries = (await log.json()).items as Array<{
    order_number: number
    status: string
    error: string | null
  }>
  const sent = entries.find((entry) => entry.status === 'sent' && (entry.error ?? '').trim())
  test.skip(!sent, 'в журнале стенда нет успешной отправки с ответом канала')

  await signInToCms(page)
  await page.goto('/cms/notifications')
  await page.getByTestId('cms-notifications-tab-log').click()
  await expect(page.getByTestId('cms-notification-log')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('cms-log-order-filter').fill(String(sent.order_number))

  const rows = page.locator('[data-testid^="cms-log-row-"]').filter({ hasText: 'Отправлено' })
  await expect(rows.first()).toBeVisible({ timeout: 20_000 })

  /*
    У КАЖДОЙ успешной строки «Ошибка» пуста. Ответ канала лежит не у всякой:
    ступень сама по себе ничего не отправляет, отправляют её строки доставки —
    поэтому квитанцию ищем среди них, а не берём первую попавшуюся.
  */
  const indexes: string[] = []
  for (const row of await rows.all()) {
    indexes.push(((await row.getAttribute('data-testid')) ?? '').replace('cms-log-row-', ''))
  }
  let withReceipt = ''
  for (const index of indexes) {
    await expect(
      page.getByTestId(`cms-log-error-${index}`),
      'у успешной отправки колонка «Ошибка» непуста',
    ).toHaveText('')
    if (!withReceipt && (await page.getByTestId(`cms-log-receipt-${index}`).innerText()).trim()) {
      withReceipt = index
    }
  }
  expect(withReceipt, 'ни у одной успешной доставки не показан ответ канала').not.toBe('')

  const receipt = page.getByTestId(`cms-log-receipt-${withReceipt}`)
  // Ответ канала НАЗВАН ПО-ЧЕЛОВЕЧЕСКИ, а не техническим словом.
  if (sent.error?.trim() === 'logged') {
    await expect(receipt).toHaveText('Записано в журнал приложения')
  }

  /*
    И ОН НЕ КРАСНЫЙ. Проверяем ВЫЧИСЛЕННЫМ цветом, а не тем, что колонка
    другая: наличие ячейки ничего не говорит о том, каким её видит человек.
  */
  const colour = await receipt.evaluate((node) => getComputedStyle(node).color)
  const [r, g, b] = (colour.match(/\d+/g) ?? ['0', '0', '0']).map(Number)
  expect(
    r - g > 40 && r - b > 40,
    `ответ канала нарисован красным (${colour}) — снова читается как ошибка`,
  ).toBe(false)
})
