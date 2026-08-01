import { request as playwrightRequest, type APIRequestContext } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Снимок стенда до прогона и уборка после.
 *
 * Задача — не «отфильтровать мусор», а не оставлять его. Правило простое и не
 * зависит от имён: всё, чего НЕ БЫЛО на стенде до прогона, создано прогоном и
 * должно быть убрано. Угадывание по имени («E2E …», «rum-servis-…») выглядит
 * работающим ровно до первого настоящего отеля, который назвали похоже.
 *
 * Почему это лежит здесь, а не в каждом тесте: тест может упасть, зависнуть или
 * быть убитым (и тогда его собственный `finally` не выполнится — этому нас
 * научил R5). Глобальный teardown отрабатывает в любом исходе прогона.
 */

const API = process.env.E2E_API_URL ?? 'http://localhost:8010'
const HOTEL = process.env.E2E_HOTEL ?? 'crystal'
const PLATFORM = {
  email: process.env.E2E_PLATFORM_EMAIL ?? 'platform@itv.local',
  password: process.env.E2E_PLATFORM_PASSWORD ?? 'platform12345',
}
const SNAPSHOT = join(process.cwd(), '.stand-snapshot.json')

export interface StandSnapshot {
  hotelIds: string[]
  serviceIds: string[]
  categoryIds: string[]
  itemIds: string[]
}

async function platformToken(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${API}/api/v1/platform/auth/login`, {
    data: { email: PLATFORM.email, password: PLATFORM.password },
  })
  if (!resp.ok()) throw new Error(`Платформа не пустила: ${resp.status()} ${await resp.text()}`)
  return (await resp.json()).access
}

async function staffToken(request: APIRequestContext): Promise<string | null> {
  // Учётка админа демо-отеля. Если её нет — просто не чистим сервисы: молчаливо
  // падать в teardown хуже, чем оставить след и сказать об этом.
  const resp = await request.post(`${API}/api/staff/auth/login`, {
    data: {
      email: process.env.E2E_ADMIN_EMAIL ?? 'owner@crystal.local',
      password: process.env.E2E_ADMIN_PASSWORD ?? 'chef12345',
    },
    headers: { 'X-Hotel-Subdomain': HOTEL },
  })
  return resp.ok() ? (await resp.json()).access : null
}

async function readStand(request: APIRequestContext): Promise<StandSnapshot> {
  const platform = await platformToken(request)
  const fleet = await request.get(`${API}/api/v1/platform/fleet?origin=all&page_size=200`, {
    headers: { Authorization: `Bearer ${platform}` },
  })
  const hotelIds: string[] = fleet.ok()
    ? ((await fleet.json()).items as { id: string }[]).map((row) => row.id)
    : []

  const staff = await staffToken(request)
  const tenant = staff
    ? { Authorization: `Bearer ${staff}`, 'X-Hotel-Subdomain': HOTEL }
    : null

  let serviceIds: string[] = []
  let categoryIds: string[] = []
  let itemIds: string[] = []
  if (tenant) {
    const services = await request.get(`${API}/api/cms/services`, { headers: tenant })
    if (services.ok()) serviceIds = ((await services.json()) as { id: string }[]).map((s) => s.id)
    const categories = await request.get(`${API}/api/cms/categories`, { headers: tenant })
    if (categories.ok()) categoryIds = ((await categories.json()) as { id: string }[]).map((c) => c.id)
    // Позиции тоже переживали прогон: раздел уборка сносила, а блюдо внутри
    // него — нет, и оно всплывало в меню заведения.
    const items = await request.get(`${API}/api/cms/items`, { headers: tenant })
    if (items.ok()) itemIds = ((await items.json()) as { id: string }[]).map((i) => i.id)
  }
  return { hotelIds, serviceIds, categoryIds, itemIds }
}

export async function snapshotStand(): Promise<void> {
  const request = await playwrightRequest.newContext()
  try {
    const snapshot = await readStand(request)
    mkdirSync(dirname(SNAPSHOT), { recursive: true })
    writeFileSync(SNAPSHOT, JSON.stringify(snapshot))
    console.log(
      `[стенд] снимок до прогона: ${snapshot.hotelIds.length} отелей, ` +
        `${snapshot.serviceIds.length} сервисов, ${snapshot.categoryIds.length} разделов`,
    )
  } finally {
    await request.dispose()
  }
}

export async function cleanupStand(): Promise<void> {
  if (!existsSync(SNAPSHOT)) {
    console.log('[стенд] снимка нет — уборка пропущена')
    return
  }
  const before: StandSnapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf-8'))
  const request = await playwrightRequest.newContext()
  try {
    const after = await readStand(request)
    const platform = await platformToken(request)
    const staff = await staffToken(request)
    const tenant = staff
      ? { Authorization: `Bearer ${staff}`, 'X-Hotel-Subdomain': HOTEL }
      : null

    const newHotels = after.hotelIds.filter((id) => !before.hotelIds.includes(id))
    const newServices = after.serviceIds.filter((id) => !before.serviceIds.includes(id))
    const newCategories = after.categoryIds.filter((id) => !before.categoryIds.includes(id))
    const newItems = after.itemIds.filter((id) => !before.itemIds.includes(id))

    // Позиции удаляем ДО разделов: раздел с позициями удалить нельзя.
    let deletedItems = 0
    for (const id of newItems) {
      if (!tenant) break
      const removed = await request.delete(`${API}/api/cms/items/${id}`, { headers: tenant })
      if (removed.ok()) deletedItems += 1
    }

    // Разделы удаляем ПЕРВЫМИ: они ссылаются на сервисы.
    for (const id of newCategories) {
      if (tenant) await request.delete(`${API}/api/cms/categories/${id}`, { headers: tenant })
    }
    // Сервис, через который успел пройти заказ, продукт удалять отказывается —
    // и правильно: удаление утащило бы историю заказов. Такие выключаем: с
    // парадной гостя они уходят, история остаётся целой. Молча считать их
    // убранными нельзя, поэтому счётчики раздельные.
    let deletedServices = 0
    let disabledServices = 0
    for (const id of newServices) {
      if (!tenant) break
      const removed = await request.delete(`${API}/api/cms/services/${id}`, { headers: tenant })
      if (removed.ok()) {
        deletedServices += 1
        continue
      }
      const disabled = await request.patch(`${API}/api/cms/services/${id}`, {
        data: { is_active: false, is_guest_facing: false },
        headers: tenant,
      })
      if (disabled.ok()) disabledServices += 1
      else console.warn(`[стенд] сервис ${id} не убран: ${removed.status()}/${disabled.status()}`)
    }
    for (const id of newHotels) {
      await request.delete(`${API}/api/v1/platform/hotels/${id}`, {
        headers: { Authorization: `Bearer ${platform}` },
        params: { confirm_subdomain: await subdomainOf(request, platform, id) },
      })
    }

    // Переписку убрать через API нечем, и это правильно: удаление сообщений
    // гостя было бы модерацией, которой в продукте нет и заводить её ради
    // тестов нельзя. Поэтому чат чистит команда стенда — инструмент разработки,
    // а не возможность продукта. Нет докера под рукой — молча пропускаем.
    const chat = await cleanChatResidue()

    console.log(
      `[стенд] убрано: ${newHotels.length} отелей, ${deletedServices} сервисов удалено` +
        `${disabledServices ? ` + ${disabledServices} выключено (есть заказы)` : ''}, ` +
        `${newCategories.length} разделов, ${deletedItems} позиций${chat}`,
    )
  } finally {
    await request.dispose()
  }
}

async function subdomainOf(
  request: APIRequestContext,
  token: string,
  hotelId: string,
): Promise<string> {
  const resp = await request.get(`${API}/api/v1/platform/hotels/${hotelId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return resp.ok() ? (await resp.json()).subdomain : ''
}


/**
 * Остатки переписки убираем командой бэкенда: API продукта удалять сообщения
 * гостя не умеет — и не должен.
 */
async function cleanChatResidue(): Promise<string> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  try {
    const { stdout } = await run('docker', [
      'compose', 'exec', '-T', 'backend',
      'python', 'manage.py', 'clean_test_residue', '--apply',
    ], { cwd: process.cwd() + '/..', timeout: 60_000 })
    const line = stdout.trim().split('\n').pop() ?? ''
    return line.includes('сообщений') ? `, чат: ${line.split('сообщений')[1].trim()}` : ''
  } catch {
    return ''
  }
}
