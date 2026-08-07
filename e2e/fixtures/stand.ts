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
 *
 * ПУСТОЙ СНИМОК — НЕ «НИЧЕГО НЕ БЫЛО», А «НЕ УЗНАЛИ».
 *
 * Здесь была мина. Снимок читался мягко: не прошёл запрос — список молча
 * оставался пустым. Дальше правило «всё, чего не было до прогона, создано
 * прогоном» превращало эту пустоту в приговор ВСЕМУ содержимому отеля: сервисы
 * без заказов удалялись, остальные выключались, а вместе с отелями сносился и
 * сам демо-стенд. Одна неудачная авторизация в момент снимка — и показывать
 * клиенту нечего.
 *
 * Теперь у пустоты два разных смысла, и они разведены:
 *   • снимок НЕ СМОГ прочитать состав — падаем громко, прогон не начинается;
 *   • снимок прочитан и по какому-то виду пуст — уборка этот вид НЕ ТРОГАЕТ.
 * Оба правила односторонние: они умеют только не убрать лишнего.
 */

const API = process.env.E2E_API_URL ?? 'http://localhost:8010'
const HOTEL = process.env.E2E_HOTEL ?? 'crystal'
const PLATFORM = {
  email: process.env.E2E_PLATFORM_EMAIL ?? 'platform@itv.local',
  password: process.env.E2E_PLATFORM_PASSWORD ?? 'platform12345',
}
const SNAPSHOT = join(process.cwd(), '.stand-snapshot.json')

/** Путь к снимку — сторожу уборки он нужен, чтобы подсунуть свой. */
export const SNAPSHOT_PATH = SNAPSHOT

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
  // Учётка админа демо-отеля. Не пустили — возвращаем `null`, а решает уже
  // вызывающий: СНИМКУ это отказ (падаем), уборке — повод не трогать
  // содержимое отеля вовсе.
  const resp = await request.post(`${API}/api/staff/auth/login`, {
    data: {
      email: process.env.E2E_ADMIN_EMAIL ?? 'owner@crystal.local',
      password: process.env.E2E_ADMIN_PASSWORD ?? 'chef12345',
    },
    headers: { 'X-Hotel-Subdomain': HOTEL },
  })
  return resp.ok() ? (await resp.json()).access : null
}

/**
 * Ответ обязан быть успешным. Иначе — исключение с телом ответа: читать состав
 * стенда «как получится» здесь нельзя, на этом списке стоит удаление.
 */
async function requireJson<T>(
  response: { ok: () => boolean; status: () => number; text: () => Promise<string>; json: () => Promise<unknown> },
  what: string,
): Promise<T> {
  if (!response.ok()) {
    throw new Error(
      `[стенд] не удалось прочитать ${what}: ${response.status()} ${(await response.text()).slice(0, 200)}`,
    )
  }
  return (await response.json()) as T
}

/**
 * Состав стенда. КАЖДЫЙ отказ — исключение, ни одного мягкого падения на
 * пустой список: на этих списках стоит удаление, и «не прочитали» не должно
 * превращаться в «там ничего не было».
 */
async function readStand(request: APIRequestContext): Promise<StandSnapshot> {
  const platform = await platformToken(request)
  const fleet = await requireJson<{ items: { id: string }[] }>(
    await request.get(`${API}/api/v1/platform/fleet?origin=all&page_size=200`, {
      headers: { Authorization: `Bearer ${platform}` },
    }),
    'список отелей',
  )
  const hotelIds = fleet.items.map((row) => row.id)

  const staff = await staffToken(request)
  if (!staff) throw new Error('[стенд] админ демо-отеля не пустил — состав отеля не прочитать')
  const tenant = { Authorization: `Bearer ${staff}`, 'X-Hotel-Subdomain': HOTEL }

  const services = await requireJson<{ id: string }[]>(
    await request.get(`${API}/api/cms/services`, { headers: tenant }),
    'сервисы отеля',
  )
  const categories = await requireJson<{ id: string }[]>(
    await request.get(`${API}/api/cms/categories`, { headers: tenant }),
    'разделы отеля',
  )
  // Позиции тоже переживали прогон: раздел уборка сносила, а блюдо внутри
  // него — нет, и оно всплывало в меню заведения.
  const items = await requireJson<{ id: string }[]>(
    await request.get(`${API}/api/cms/items`, { headers: tenant }),
    'позиции отеля',
  )

  return {
    hotelIds,
    serviceIds: services.map((s) => s.id),
    categoryIds: categories.map((c) => c.id),
    itemIds: items.map((i) => i.id),
  }
}

export async function snapshotStand(): Promise<void> {
  const request = await playwrightRequest.newContext()
  try {
    // Исключение отсюда роняет globalSetup, а значит — весь прогон, и до
    // уборки дело не доходит вовсе. Это и нужно: прогон без снимка опаснее,
    // чем непройденный прогон.
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

/**
 * ЧТО ИМЕННО УБИРАТЬ — отдельным решением, до единого запроса на удаление.
 *
 * Вынесено из уборки не ради красоты: здесь жила мина, и проверять её на живом
 * стенде значит ломать стенд ровно тогда, когда защита отвалилась. Решение —
 * чистая функция от двух снимков, у неё нет ни сети, ни прав, ни последствий,
 * и сторож проверяет именно её.
 *
 * Пустой вид в снимке «до» — ЗАПРЕТ на уборку этого вида: правило «нового не
 * было в снимке» работает, только если снимок этот вид видел. Пустой список
 * значит обратное — сравнивать не с чем, и любое «новое» здесь это весь отель.
 */
export function plannedRemovals(
  before: StandSnapshot,
  after: StandSnapshot,
): { hotels: string[]; services: string[]; categories: string[]; items: string[]; blind: string[] } {
  const fresh = (kind: keyof StandSnapshot) =>
    before[kind].length ? after[kind].filter((id) => !before[kind].includes(id)) : []
  const blind = (['hotelIds', 'serviceIds', 'categoryIds', 'itemIds'] as const)
    .filter((kind) => before[kind].length === 0)
    .map((kind) => kind.replace('Ids', ''))
  return {
    hotels: fresh('hotelIds'),
    services: fresh('serviceIds'),
    categories: fresh('categoryIds'),
    items: fresh('itemIds'),
    blind,
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
    /*
      ПУСТОЙ ВИД В СНИМКЕ — ЗАПРЕТ НА УБОРКУ ЭТОГО ВИДА.

      Правило «нового не было в снимке» работает, только если снимок этот вид
      действительно видел. Пустой список означает ровно обратное: сравнивать не
      с чем, и любое «новое» здесь — весь отель целиком. Поэтому каждый вид
      убирается только при непустом снимке по нему, и решение принимается ДО
      первого запроса на удаление.
    */
    const blindKinds = plannedRemovals(before, before).blind
    if (blindKinds.length) {
      console.warn(
        `[стенд] СНИМОК ПУСТ по видам: ${blindKinds.join(', ')} — уборка по ним ПРОПУЩЕНА. ` +
          'Пустой снимок значит «не прочитали», а не «ничего не было»: убирать по нему — ' +
          'снести стенд целиком.',
      )
    }
    if (blindKinds.length === 4) {
      console.warn('[стенд] снимок пуст целиком — уборка не делает ничего')
      return
    }

    const after = await readStand(request)
    const platform = await platformToken(request)
    const staff = await staffToken(request)
    const tenant = staff
      ? { Authorization: `Bearer ${staff}`, 'X-Hotel-Subdomain': HOTEL }
      : null

    const planned = plannedRemovals(before, after)
    const newHotels = planned.hotels
    const newServices = planned.services
    const newCategories = planned.categories
    const newItems = planned.items

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
