import { type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, apiGet, apiHeaders, apiToken, pickOption, signIn } from './helpers'

/**
 * ВИДЫ МЕНЮ У ГОСТЯ — СТОРОНА CMS (партия 57).
 *
 * - у позиции товарного заведения есть галочка «Крупно в мозаике», и она
 *   сохраняется вместе с формой;
 * - у товарного сервиса есть «Вид меню у гостя по умолчанию», у спа — нет
 *   (сервер ответил бы 422 `menu_view_unsupported`, поле там лишнее);
 * - «Быстрые действия» стали вкладкой «Плитки экрана номера» в «Управлении
 *   номером», старый адрес уводит на неё.
 *
 * Всё, что тест меняет на стенде, возвращается в `finally` — по API, тем же
 * значением, что было до него.
 */

interface Service {
  id: string
  code: string
  type: string
  menu_view?: 'cards' | 'mosaic'
  menu_view_available?: boolean
}
interface ItemRow {
  id: string
  category_id: string
  type?: string
  mosaic_large?: boolean
}
type Node = { id: string; service_id?: string | null; children?: Node[] }
const walk = (nodes: Node[]): Node[] => nodes.flatMap((node) => [node, ...walk(node.children ?? [])])

async function services(request: APIRequestContext, token: string): Promise<Service[]> {
  return (await apiGet<{ items: Service[] }>(request, token, '/api/cms/services')).items
}

async function byType(request: APIRequestContext, token: string, type: string): Promise<Service> {
  // Демо-сервис по коду типа (kitchen — ресторан, spa — спа), а не первый попавшийся:
  // на стенде копятся сервисы-остатки прогонов без меню.
  const preferred = { restaurant: 'kitchen', spa: 'spa' } as Record<string, string>
  const rows = await services(request, token)
  const found = rows.find((row) => row.code === preferred[type]) ?? rows.find((row) => row.type === type)
  expect(found, `на стенде нет сервиса типа ${type}`).toBeTruthy()
  return found!
}

async function patchService(request: APIRequestContext, token: string, id: string, data: object) {
  const response = await request.patch(`${API}/api/cms/services/${id}`, { headers: apiHeaders(token), data })
  expect(response.ok(), `PATCH сервиса -> ${response.status()}`).toBeTruthy()
}

async function patchItem(request: APIRequestContext, token: string, id: string, data: object) {
  const response = await request.patch(`${API}/api/cms/items/${id}`, { headers: apiHeaders(token), data })
  expect(response.ok(), `PATCH позиции -> ${response.status()}`).toBeTruthy()
}

test.describe('Виды меню: CMS (партия 57)', () => {
  test('«Крупно в мозаике» у позиции ресторана видна и сохраняется', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)
    const restaurant = await byType(request, token, 'restaurant')
    const tree = await apiGet<Node[]>(request, token, '/api/cms/categories?all_types=1')
    const sections = new Set(walk(tree).filter((n) => n.service_id === restaurant.id).map((n) => n.id))
    const items = (await apiGet<{ items: ItemRow[] }>(request, token, '/api/cms/items?limit=200')).items
    const item = items.find((row) => sections.has(row.category_id) && (row.type ?? 'product') === 'product')
    expect(item, 'у ресторана нет ни одной товарной позиции').toBeTruthy()
    const before = Boolean(item!.mosaic_large)

    await signIn(page, ADMIN)
    try {
      await page.goto(`/cms/menu/items/${item!.id}`)
      const toggle = page.getByTestId('item-mosaic-large-switch')
      await expect(toggle).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('item-mosaic-large-hint')).toBeVisible()
      if (before) await expect(toggle).toBeChecked()
      else await expect(toggle).not.toBeChecked()

      await toggle.click()
      await page.getByTestId('item-save-button').click()
      await expect(page.getByTestId('item-dirty-badge')).toBeHidden({ timeout: 15_000 })

      // Результат — на сервере, а не в нарисованной галочке.
      await expect
        .poll(async () => (await apiGet<ItemRow>(request, token, `/api/cms/items/${item!.id}`)).mosaic_large, {
          timeout: 10_000,
        })
        .toBe(!before)

      // После перезагрузки галочка стоит так, как сохранили.
      await page.reload()
      const again = page.getByTestId('item-mosaic-large-switch')
      await expect(again).toBeVisible({ timeout: 20_000 })
      if (before) await expect(again).not.toBeChecked()
      else await expect(again).toBeChecked()
    } finally {
      await patchItem(request, token, item!.id, { mosaic_large: before })
    }
  })

  test('вид меню по умолчанию: у ресторана выбор есть и сохраняется, у спа — нет', async ({ page, request }) => {
    const token = await apiToken(request, ADMIN)
    const restaurant = await byType(request, token, 'restaurant')
    const spa = await byType(request, token, 'spa')
    expect(restaurant.menu_view_available).toBe(true)
    expect(spa.menu_view_available).toBe(false)
    const before = restaurant.menu_view ?? 'cards'
    const next = before === 'cards' ? 'mosaic' : 'cards'

    await signIn(page, ADMIN)
    try {
      await page.goto(`/cms/services/${restaurant.id}`)
      await expect(page.getByTestId('service-menu')).toBeVisible({ timeout: 20_000 })
      const select = page.getByTestId('service-menu-view-select')
      await expect(select).toBeVisible()
      await expect(select).toHaveAttribute('data-value', before)

      await pickOption(page, 'service-menu-view-select', { value: next })
      await expect
        .poll(async () => (await apiGet<Service>(request, token, `/api/cms/services/${restaurant.id}`)).menu_view, {
          timeout: 10_000,
        })
        .toBe(next)
      await page.reload()
      await expect(page.getByTestId('service-menu-view-select')).toHaveAttribute('data-value', next, {
        timeout: 20_000,
      })

      // Спа: меню есть, выбора вида нет.
      await page.goto(`/cms/services/${spa.id}`)
      await expect(page.getByTestId('cms-service-workspace')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('service-tab-schedule')).toBeVisible()
      await expect(page.getByTestId('service-menu-view-select')).toHaveCount(0)
    } finally {
      await patchService(request, token, restaurant.id, { menu_view: before })
    }
  })

  test('«Плитки экрана номера» — вкладка «Управления номером», старый адрес ведёт на неё', async ({ page }) => {
    await signIn(page, ADMIN)

    await page.goto('/cms/room-control')
    const tab = page.getByTestId('grms-tab-tiles')
    await expect(tab).toBeVisible({ timeout: 20_000 })
    await tab.click()
    await expect(page).toHaveURL(/\/cms\/room-control\?(.*&)?tab=tiles/)
    await expect(page.getByTestId('cms-quick-actions')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('cms-quick-actions-save')).toBeVisible()

    // Старый раздел — не тупик и не дашборд: та же вкладка.
    await page.goto('/cms/quick-actions')
    await expect(page).toHaveURL(/\/cms\/room-control\?(.*&)?tab=tiles/, { timeout: 20_000 })
    await expect(page.getByTestId('grms-tab-tiles')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('cms-quick-actions')).toBeVisible({ timeout: 20_000 })
  })
})
