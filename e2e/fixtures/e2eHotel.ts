import { request as playwrightRequest } from '@playwright/test'

/**
 * СВОЙ ОТЕЛЬ ПРОГОНА ДЛЯ ПРОВЕРОК, ПРАВЯЩИХ НАСТРОЙКИ (партия 58в).
 *
 * Дважды прерванный прогон испортил «Кристалл»: шахматка фоном бренда (05.10)
 * и °F у Москвы. Проверка правила настройку демо-отеля и возвращала то, что
 * прочитала в начале, — после прерванного прогона «исходным» было уже
 * испорченное. Теперь проверки, которые правят бренд, главную, погоду,
 * коммерцию и т. п., идут на своём отеле `e2e-hotel`:
 *
 *   * заводится в начале прогона ПОСЛЕ снимка стенда тем же сидом, что
 *     «Кристалл» (тот же каталог, номера, имя), — значит, его уберёт штатная
 *     уборка в конце, как любой отель, созданный прогоном;
 *   * оставшийся от прерванного прогона убирается ДО снимка;
 *   * проект Playwright `own-hotel` перенаправляет на него весь трафик своих
 *     проверок (`tests/fixtures.ts`), и сами проверки менять не нужно.
 *
 * Демо-отели в e2e — только чтение настроек: сторож в `tests/fixtures.ts`.
 */
export const E2E_HOTEL = process.env.E2E_HOTEL ?? 'e2e-hotel'
const API = process.env.E2E_API_URL ?? 'http://localhost:8010'
const PLATFORM = { email: 'platform@itv.local', password: process.env.E2E_PLATFORM_PASSWORD ?? 'platform12345' }

async function manage(args: string[], timeout = 300_000): Promise<string> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const { stdout } = await run('docker', ['compose', 'exec', '-T', 'backend', 'python', 'manage.py', ...args], {
    cwd: process.cwd() + '/..',
    timeout,
  })
  return stdout.trim()
}

/** Убрать отели `e2e-…`, оставшиеся от прерванных прогонов (до снимка стенда). */
export async function dropLeftoverE2EHotels(): Promise<number> {
  const api = await playwrightRequest.newContext()
  try {
    const login = await api.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
    if (!login.ok()) return 0
    const token = (await login.json()).access as string
    const headers = { Authorization: `Bearer ${token}` }
    const fleet = await (await api.get(`${API}/api/v1/platform/hotels?limit=1000`, { headers })).json()
    const rows = ((fleet.items ?? fleet) as Array<{ id: string; subdomain: string }>).filter((row) =>
      row.subdomain?.startsWith('e2e-'),
    )
    for (const row of rows) {
      await api.delete(`${API}/api/v1/platform/hotels/${row.id}`, {
        headers,
        params: { confirm_subdomain: row.subdomain },
      })
    }
    await api.post(`${API}/api/v1/platform/auth/logout`, { headers })
    return rows.length
  } finally {
    await api.dispose()
  }
}

/** Завести отель прогона тем же сидом, что «Кристалл» (после снимка стенда). */
export async function seedE2EHotel(): Promise<void> {
  await manage([
    'seed_demo_hotel',
    '--subdomain',
    E2E_HOTEL,
    '--name',
    'Отель «Кристалл»',
    '--with-rich-catalog',
    '--with-room-control',
  ])
  // Фото сида режет воркер — около сотни нарезок. Пока очередь занята, свои
  // загрузки проверок ждут дольше их таймаута («картинка не нарезалась»), —
  // поэтому прогон начинается, когда фото отеля прогона готовы.
  const started = Date.now()
  for (;;) {
    const left = Number(
      (
        await manage([
          'shell',
          '-c',
          `from apps.core.context import tenant_context; from apps.hotels.models import Hotel; from apps.media.models import MediaAsset
h = Hotel.objects.get(subdomain='${E2E_HOTEL}')
with tenant_context(h): print(MediaAsset.objects.exclude(status__in=['ready', 'failed']).count())`,
        ])
      )
        .split('\n')
        .pop(),
    )
    if (!left || Date.now() - started > 300_000) break
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  // Признак «тестовый»: удаляется без ввода поддомена — его и завели затем,
  // чтобы удалить.
  await manage([
    'shell',
    '-c',
    `from apps.hotels.models import Hotel; Hotel.objects.filter(subdomain='${E2E_HOTEL}').update(origin=Hotel.Origin.TEST)`,
  ])
}
