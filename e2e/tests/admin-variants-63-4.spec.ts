import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, PLATFORM, pickOption } from './helpers'

/**
 * ВАРИАНТЫ НОМЕРОВ — ПРАВКА (партия 63-4, шаг B). Серверная половина —
 * `backend/tests/grms/test_variants_63_4.py`.
 *
 * Один проход оператора на своём отеле прогона (`origin=test`): новый вариант
 * копией варианта Кристалла (каналы приезжают с ним; номера и версии — нет) →
 * кнопка для гостя с проверкой смысла связи → номера выделением на схеме →
 * публикация с подтверждением «изменится у N номеров» → «История».
 * Кристалл только читается.
 */

const mark = Date.now().toString(36)
const SUB = `var${mark}`

let headers: Record<string, string> = {}
let hotelId = ''
let crystalId = ''

async function platformToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
  expect(response.ok(), `вход в консоль -> ${response.status()}`).toBeTruthy()
  return (await response.json()).access
}

async function enter(page: Page, query: string) {
  const tokens = await (await page.request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })).json()
  await page.goto('/admin')
  await page.evaluate(([a, r]) => {
    window.localStorage.clear()
    window.localStorage.setItem('itv.platform.access', a)
    window.localStorage.setItem('itv.platform.refresh', r)
  }, [tokens.access, tokens.refresh])
  await page.goto(`/admin?section=fleet&hotel=${hotelId}&tab=roomControl${query}`)
}

test.describe.serial('Варианты номеров — правка', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000)
    headers = { Authorization: `Bearer ${await platformToken(request)}` }
    const list = await (await request.get(`${API}/api/v1/platform/hotels?limit=1000`, { headers })).json()
    crystalId = (list.items ?? list).find((h: { subdomain: string }) => h.subdomain === 'crystal').id
    const created = await request.post(`${API}/api/v1/platform/hotels`, {
      data: { subdomain: SUB, name: `Варианты ${mark}`, admin_email: `admin@${SUB}.test`, origin: 'test' },
      headers,
    })
    expect(created.ok(), await created.text()).toBeTruthy()
    const body = await created.json()
    hotelId = body.hotel?.id ?? body.id
    await request.put(`${API}/api/v1/platform/hotels/${hotelId}/modules/room_control`, { data: { enabled: true }, headers })
    const made = await request.post(`${API}/api/v1/platform/hotels/${hotelId}/rooms/bulk`, { data: { spec: '701-704' }, headers })
    expect(made.ok(), await made.text()).toBeTruthy()
  })

  test('новый вариант → кнопка → номера → публикация', async ({ page }) => {
    test.setTimeout(180_000)
    await enter(page, '')
    await expect(page.getByTestId('admin-variants-none')).toBeVisible({ timeout: 30_000 })

    // 1. Новый вариант — копия варианта Кристалла.
    await page.getByTestId('admin-variant-new-open').click()
    const dialog = page.getByTestId('admin-variant-new')
    await dialog.getByTestId('admin-variant-new-mode-copy_other').click()
    await pickOption(page, 'admin-variant-new-hotel', { value: crystalId })
    await pickOption(page, 'admin-variant-new-other', { value: 'demo-suite' })
    await dialog.getByTestId('admin-variant-new-title-ru').fill('Стандарт e2e')
    await dialog.getByTestId('admin-variant-new-create').click()
    await expect(page.getByTestId('admin-variant-pane-base')).toBeVisible({ timeout: 20_000 })
    await expect(page).toHaveURL(/variant=standart-e2e/)
    await expect(page.getByTestId('admin-variant-state')).toHaveText('не опубликован')

    // 2. Кнопка для гостя. Один канал — одна кнопка: в копии все каналы заняты,
    // поэтому убираем скопированные «Свет в спальне» и «Блэкаут» — их каналы свободны.
    await page.getByTestId('admin-variant-step-buttons').click()
    for (const slug of ['light.bedroom', 'curtain.blackout']) {
      await page.getByTestId(`admin-variant-button-remove-${slug}`).click()
      await page.getByTestId('admin-variant-button-remove-confirm').click()
      await expect(page.getByTestId(`admin-variant-button-${slug}`)).toHaveCount(0)
    }
    // Свет у кровати: занятый канал не выбрать; канал шторы — предупреждение о смысле.
    await page.getByTestId('admin-variant-button-add').click()
    const add = page.getByTestId('admin-variant-button-add-dialog')
    await add.getByTestId('admin-variant-kind-light_group').click()
    await pickOption(page, 'admin-variant-button-zone', { value: 'bedroom' })
    await add.getByTestId('admin-variant-button-title-ru').fill('Свет у кровати')
    await add.getByTestId('admin-variant-button-add-save').click()
    const button = page.getByTestId('admin-variant-button-dialog')
    await expect(button.getByTestId('admin-variant-ability-toggle')).toHaveAttribute('data-linked', 'false')
    await button.getByTestId('admin-variant-pick-toggle').click()
    const picker = page.getByTestId('admin-variant-channel-picker')
    await expect(picker.getByTestId('admin-variant-channel-light_living')).toHaveAttribute('data-fit', 'bad')
    await expect(picker.getByTestId('admin-variant-channel-light_living')).toContainText('Свет в гостиной')
    await expect(picker.getByTestId('admin-variant-channel-light_bedroom')).toHaveAttribute('data-fit', 'good')
    await expect(picker.getByTestId('admin-variant-channel-curtain_blackout')).toHaveAttribute('data-fit', 'warn')
    await picker.getByTestId('admin-variant-channel-curtain_blackout').click()
    await expect(page.getByTestId('admin-variant-sense-text')).toContainText('похож на: шторы')
    await page.getByTestId('admin-variant-sense-cancel').click()
    await expect(page.getByTestId('admin-variant-sense-dialog')).toHaveCount(0)
    await picker.getByTestId('admin-variant-channel-light_bedroom').click()
    await expect(button.getByTestId('admin-variant-ability-toggle')).toHaveAttribute('data-linked', 'true', { timeout: 15_000 })
    await button.getByTestId('admin-variant-button-done').click()
    const row = page.locator('[data-testid^="admin-variant-button-light.bedroom"]').first()
    await expect(row).toHaveAttribute('data-ready', 'true')

    // 3. Номера — выделением на схеме, тот же показ, что в «Номерном фонде».
    await page.getByTestId('admin-variant-step-rooms').click()
    await page.getByTestId('admin-room-701').click()
    await page.getByTestId('admin-room-702').click()
    await expect(page.getByTestId('admin-variant-rooms-selection')).toContainText('2')
    await page.getByTestId('admin-variant-rooms-assign').click()
    await page.getByTestId('admin-rooms-batch-preview').click()
    await page.getByTestId('admin-rooms-batch-run').click()
    await page.getByTestId('admin-rooms-batch-close').click()
    await expect(page.getByTestId('admin-variant-rooms-summary')).toContainText('2 номера', { timeout: 15_000 })

    // 4. Проверка: тестовая команда только через подтверждение «номер, что, значение».
    await page.getByTestId('admin-variant-step-check').click()
    await pickOption(page, 'admin-variant-test-button', { value: 'light.bedroom' })
    await page.getByTestId('admin-variant-test-open').click()
    await expect(page.getByTestId('admin-variant-test-summary')).toContainText('701')
    await expect(page.getByTestId('admin-variant-test-summary')).toContainText('Свет у кровати')
    await expect(page.getByTestId('admin-variant-test-summary')).toContainText('включить')
    await page.getByTestId('admin-variant-test-confirm').getByRole('button', { name: 'Отмена' }).click()

    // 5. Публикация: «изменится у 2 номеров» — подтверждение — версия 1.
    await page.getByTestId('admin-variant-step-publish').click()
    await expect(page.getByTestId('admin-variant-change-control_added').first()).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('admin-variant-publish').click()
    await expect(page.getByTestId('admin-variant-publish-rooms')).toContainText('2 номеров')
    await page.getByTestId('admin-variant-publish-go').click()
    await expect(page.getByTestId('admin-variant-published')).toContainText('версия 1', { timeout: 20_000 })
    await expect(page.getByTestId('admin-variant-state')).toHaveText('опубликован', { timeout: 15_000 })
    await expect(page.getByTestId('admin-variant-diff-same')).toBeVisible()

    // «История» отеля: кнопка и связь — «было → стало».
    await page.goto(`/admin?section=fleet&hotel=${hotelId}&tab=history`)
    await expect(page.getByText('Кнопка связана с каналом').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('admin-journal-change-button').first()).toContainText('Свет у кровати')
  })

  test('вариант с номерами не удаляется — сказано, куда их деть', async ({ page }) => {
    await enter(page, '&variant=standart-e2e&step=base')
    await page.getByTestId('admin-variant-delete').click()
    await expect(page.getByTestId('admin-variant-delete-blocked')).toContainText('2 номера')
    await expect(page.getByTestId('admin-variant-delete-confirm')).toHaveCount(0)
    await page.getByTestId('admin-variant-delete-to-rooms').click()
    await expect(page.getByTestId('admin-variant-pane-rooms')).toBeVisible()
  })
})
