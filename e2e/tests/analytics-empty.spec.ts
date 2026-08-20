import { expect, test, type APIRequestContext } from '@playwright/test'

import { API } from './helpers'

/**
 * УКУС: отель в день запуска открывает аналитику и получает ОТВЕТ, а не 500.
 *
 * Разрез по точкам отвечал ему `IndexError`: `_sort_rows` заводил пустой список
 * внутрь ветки, которая первым же действием читает `rows[0]`. На демо-стенде с
 * сотнями заказов это не воспроизводилось никогда — а у КАЖДОГО нового отеля
 * ломалось с первого клика.
 *
 * Проверяем все семь разрезов: падало одно место, но пустой набор проходит
 * через все, и чинить по одному значит узнавать о следующем от клиента.
 *
 * Проверка на УРОВНЕ API, а не глазами: дефектом был код ответа, и увидеть его
 * надо кодом. Пустые состояния экранов («данных пока нет») живут в четырёх
 * вкладках отдельно и своей правки не требовали — до них дело просто не
 * доходило, пока сервер отвечал ошибкой.
 */

const PLATFORM = { email: 'platform@itv.local', password: 'platform12345' }

const CUTS = [
  'scope',
  'summary',
  'timeseries',
  'breakdown',
  'operations',
  'traffic',
  'reviews',
  'drilldown',
]

async function platformToken(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })
  expect(resp.ok(), await resp.text()).toBeTruthy()
  return (await resp.json()).access
}

test('аналитика отеля без единого заказа отвечает пустотой, а не ошибкой', async ({ request }) => {
  test.slow()
  const token = await platformToken(request)

  // Отель заводим свой и пустой: у демо-отеля заказы есть, и «пусто» на нём не
  // воспроизвести ничем.
  const subdomain = `empty${Date.now().toString(36)}`
  const created = await request.post(`${API}/api/v1/platform/hotels`, {
    data: {
      subdomain,
      name: `Пустой ${subdomain}`,
      admin_email: `a@${subdomain}.test`,
      template: 'blank',
    },
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const hotelId: string = (await created.json()).hotel.id

  try {
    /*
      Токен CMS берём тем же путём, каким в отель входит консоль: пароль
      администратора уходит ТОЛЬКО письмом и в ответе не возвращается — и это
      правильно, чинить ради теста нечего. Вход поддержки даёт одноразовый код,
      который меняется на токен по поддомену отеля.
    */
    const enter = await request.post(`${API}/api/v1/platform/hotels/${hotelId}/enter`, {
      data: { reason: 'e2e: аналитика пустого отеля' },
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(enter.ok(), `вход в отель -> ${await enter.text()}`).toBeTruthy()
    const exchanged = await request.post(`${API}/api/staff/auth/support-exchange`, {
      data: { code: (await enter.json()).code },
      headers: { 'X-Hotel-Subdomain': subdomain },
    })
    expect(exchanged.ok(), `обмен кода -> ${await exchanged.text()}`).toBeTruthy()
    const staff = (await exchanged.json()).access
    const headers = { Authorization: `Bearer ${staff}`, 'X-Hotel-Subdomain': subdomain }

    for (const cut of CUTS) {
      const resp = await request.get(`${API}/api/v1/cms/analytics/${cut}?preset=month`, { headers })
      expect(resp.status(), `${cut} -> ${resp.status()} ${await resp.text()}`).toBe(200)
    }

    // Явная сортировка — отдельная ветка кода, и пустой набор обязан пройти её
    // тоже: «нечего сортировать» и «не сказали, по чему» — разные случаи.
    for (const query of ['', '&sort=orders', '&sort=revenue_minor&order=asc']) {
      const resp = await request.get(
        `${API}/api/v1/cms/analytics/operations?preset=month${query}`,
        { headers },
      )
      expect(resp.status(), `operations${query} -> ${await resp.text()}`).toBe(200)
      expect((await resp.json()).by_point).toEqual([])
    }
  } finally {
    // След за собой: одноразовый отель уносим со стенда.
    await request.post(`${API}/api/v1/platform/hotels/${hotelId}/purge`, {
      data: { confirm: subdomain },
      headers: { Authorization: `Bearer ${token}` },
    })
    await request.delete(`${API}/api/v1/platform/hotels/${hotelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  }
})
