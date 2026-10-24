import path from 'node:path'
import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, PLATFORM } from './helpers'

/**
 * ПАРА КАДРОВ ПЛАНА — РЕДАКТОР ПОКАЗЫВАЕТ ЕЁ СРАЗУ (партия 64-1).
 *
 * Найдено на сборке «Сиалии»: после загрузки СВОЕЙ пары (светлый + ночной)
 * редактор стоял на «Кадра нет», пока его не закроешь и не откроешь. Адрес
 * кадра появляется после обработки медиа (секунды), а опрос включался только
 * когда ночного кадра ещё нет — у пары он есть сразу, и опрос не шёл вовсе.
 *
 * Свой отель прогона (`origin=test`), вариант — копия варианта «Кристалла».
 */

const mark = Date.now().toString(36)
const SUB = `pair${mark}`
const LIT = path.resolve(__dirname, '../../docs/design/grms-concept/render-type1-cropped.png')
const OFF = path.resolve(__dirname, '../../docs/design/grms-concept/render-type1-cropped-off-v2.png')

let headers: Record<string, string> = {}
let hotelId = ''
let code = ''

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

test.describe.serial('План: пара кадров видна сразу', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000)
    headers = { Authorization: `Bearer ${await platformToken(request)}` }
    const list = await (await request.get(`${API}/api/v1/platform/hotels?limit=1000`, { headers })).json()
    const crystal = (list.items ?? list).find((h: { subdomain: string }) => h.subdomain === 'crystal').id
    const created = await request.post(`${API}/api/v1/platform/hotels`, {
      data: { subdomain: SUB, name: `Пара ${mark}`, admin_email: `admin@${SUB}.test`, origin: 'test' },
      headers,
    })
    expect(created.ok(), await created.text()).toBeTruthy()
    const body = await created.json()
    hotelId = body.hotel?.id ?? body.id
    await request.put(`${API}/api/v1/platform/hotels/${hotelId}/modules/room_control`, { data: { enabled: true }, headers })
    const variant = await request.post(`${API}/api/v1/platform/hotels/${hotelId}/grms/variants`, {
      data: { title: { ru: 'Пара кадров' }, source: 'demo-suite', source_hotel: crystal },
      headers,
    })
    expect(variant.ok(), await variant.text()).toBeTruthy()
    code = (await variant.json()).code
  })

  test('после загрузки пары сцена редактора видна без переоткрытия', async ({ page }) => {
    test.setTimeout(120_000)
    await enter(page, `&variant=${code}&step=plan`)
    await page.getByTestId('admin-variant-markup-open').click()
    await expect(page.getByTestId('grms-plan-no-frame')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('grms-plan-lit-input').setInputFiles(LIT)
    await page.getByTestId('grms-plan-off-input').setInputFiles(OFF)
    await page.getByTestId('grms-plan-upload').click()
    await expect(page.getByTestId('grms-plan-stage')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('grms-plan-no-frame')).toHaveCount(0)
  })
})
