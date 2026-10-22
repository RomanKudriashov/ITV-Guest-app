import { type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, PLATFORM, signInPlatform } from './helpers'

/**
 * СИСТЕМНЫЕ ЗАПИСИ В «ИСТОРИИ» И ЧИПЫ БЕЗ КОДОВ (партия 62-E1-хвост).
 *
 * На стенде «История» Сиалии была пустой, хотя миграция 0049 записала в журнал
 * пять выключенных модулей: экран брал только записи людей. На пустой выдаче
 * чип фильтра показывал код — «Что: modules». Сервер — `test_history_system_62e1.py`.
 *
 * Системные записи «Кристалла» локально оставила та же миграция 0049. Пустая
 * выдача — подменой ответа: стенд не трогаем.
 */

const CODE = /\b(modules|system|in_development|platform\.[a-z_.]+)\b/

async function crystalId(request: APIRequestContext): Promise<string> {
  const access = (await (await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })).json()).access
  const fleet = await (
    await request.get(`${API}/api/v1/platform/fleet?search=crystal&origin=all`, { headers: { Authorization: `Bearer ${access}` } })
  ).json()
  return (fleet.items as { id: string; subdomain: string }[]).find((row) => row.subdomain === 'crystal')!.id
}

test.describe('«История» отеля: записи системы', () => {
  test('системная запись видна, автор «Система», фильтр «Кто → Система» оставляет только её', async ({ page, request }) => {
    const id = await crystalId(request)
    const history = await (
      await request.get(`${API}/api/v1/platform/hotels/${id}/history?who=system`, {
        headers: { Authorization: `Bearer ${(await (await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })).json()).access}` },
      })
    ).json()
    test.skip(!history.total, 'у «Кристалла» нет системных записей — миграция 0049 ничего не выключала')

    await signInPlatform(page, PLATFORM)
    await page.goto(`/admin?section=fleet&hotel=${id}&tab=history&who=system`)
    const rows = page.getByTestId('admin-history-row')
    await expect(rows.first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('admin-history-count')).toContainText(`из ${history.total}`)
    for (const row of await rows.all()) {
      await expect(row).toContainText('Система')
    }
    await expect(rows.first()).toContainText('модуль в разработке')
    await expect(page.getByTestId('admin-history')).not.toContainText('in_development')
    // Чип — словом.
    await expect(page.getByTestId('admin-hotels-chip-who-system')).toHaveText(/Кто: Система/)

    // Вариант «Система» есть и в самом фильтре.
    await page.getByTestId('admin-hotels-facet-who').click()
    await expect(page.getByTestId('admin-hotels-option-who-system')).toContainText('Система')
  })
})

test.describe('Чипы фильтров на пустой выдаче — словами, не кодами', () => {
  test('«История»: «Что: Модули», «Кто: Система»', async ({ page, request }) => {
    const id = await crystalId(request)
    await page.route(`**/api/v1/platform/hotels/${id}/history*`, (route) =>
      route.fulfill({ json: { items: [], total: 0, next_cursor: null, facets: { who: [], what: [] } } }),
    )
    await signInPlatform(page, PLATFORM)
    await page.goto(`/admin?section=fleet&hotel=${id}&tab=history&what=modules,profile:timezone&who=system`)
    const chips = page.getByTestId('admin-hotels-active-filters')
    await expect(chips).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('admin-hotels-chip-what-modules')).toHaveText(/Что: Модули/)
    await expect(page.getByTestId('admin-hotels-chip-what-profile:timezone')).toHaveText(/Профиль · /)
    await expect(page.getByTestId('admin-hotels-chip-who-system')).toHaveText(/Кто: Система/)
    await expect(chips).not.toContainText(CODE)
  })

  test('«Журнал действий»: вид действия и прочие чипы без кодов, пока справочники пусты', async ({ page }) => {
    await page.route('**/api/v1/platform/audit/actions*', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/platform/audit?*', (route) => route.fulfill({ json: { items: [], total: 0, next_cursor: null } }))
    await signInPlatform(page, PLATFORM)
    await page.goto('/admin?section=audit&action=platform.hotel.modules_set&who=00000000-0000-0000-0000-000000000000&period=week')
    const chips = page.getByTestId('admin-hotels-active-filters')
    await expect(chips).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('admin-hotels-chip-action-platform.hotel.modules_set')).not.toContainText('platform.')
    await expect(page.getByTestId('admin-hotels-chip-who-00000000-0000-0000-0000-000000000000')).toContainText('неизвестное значение')
    await expect(chips).not.toContainText(CODE)
    await expect(chips).not.toContainText('00000000')
  })
})
