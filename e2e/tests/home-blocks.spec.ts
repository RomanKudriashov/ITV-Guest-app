import { expect, test, type Page } from '@playwright/test'

import { DEMO_ROOM } from './helpers'

/**
 * Главная: погода, местное время и строка состояния номера.
 *
 * ВНЕШНИЙ СЕРВИС ЗДЕСЬ НЕ УЧАСТВУЕТ. Погода приезжает полем гостевого ответа,
 * и сторож подменяет ИМЕННО ЕГО: провайдер, сеть до него и его лимиты — не наш
 * предмет проверки, а прогон, который ходит в интернет, краснеет от чужого
 * сбоя и молчит о нашем. Заодно это единственный способ проверить то, что на
 * живом стенде поймать нельзя: протухшие данные, отсутствие координат и
 * недоступного провайдера.
 */

async function enterRoom(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 20_000 })
}

/** Подменяет поля главной, не трогая остальной ответ сервера. */
async function homeAnswers(page: Page, patch: Record<string, unknown>): Promise<void> {
  // Со ЗВЁЗДОЧКОЙ НА ХВОСТЕ: витрина зовёт `/guest/home?lang=…`, и точный
  // путь мимо неё промахивается — подмена молча не срабатывает, а тест
  // краснеет на настоящих данных стенда.
  await page.route('**/guest/home**', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ response, json: { ...body, ...patch } })
  })
}

test.describe('Главная: погода и время', () => {
  // Пояс прогона фиксируем: часы отеля — про разницу с гостем, и «показывать
  // ли их» зависит от пояса устройства. Без этого проверка означала бы разное
  // на машине разработчика и в CI.
  test.use({ timezoneId: 'Europe/Moscow' })

  test('погода есть — градусы и состояние НАШИМ словом, без подписи источника', async ({
    page,
  }) => {
    await homeAnswers(page, {
      weather: { temperature_c: 21.4, code: 61, is_day: true, observed_at: new Date().toISOString() },
    })
    await enterRoom(page)

    const block = page.getByTestId('guest-home-weather')
    await expect(block).toBeVisible({ timeout: 15_000 })
    await expect(block).toContainText('21°')
    // Код 61 — это дождь. Слово наше: текст провайдера есть не на всех наших
    // языках, и «Slight rain» посреди русского интерфейса — брак.
    await expect(block).toContainText(/Дождь/i)

    /*
      ПОДПИСИ ИСТОЧНИКА НА ГЛАВНОЙ НЕТ — по прямому решению владельца продукта.

      Сторож проверяет это явно, а не молчит: раньше здесь стояла обратная
      проверка (атрибуция обязана быть), и снятие подписи её уронило. Замена
      проверки — не «починка красного теста», а запись решения: вернётся
      подпись — этот тест упадёт и заставит решение подтвердить.

      Цена вопроса записана в docs/ops/weather.md: данные Open-Meteo идут под
      CC BY 4.0, и указание источника требуется при любом использовании,
      включая платный план и свой экземпляр.
    */
    await expect(page.getByTestId('guest-home-weather-attribution')).toHaveCount(0)

    /*
      ГОРОД ПОДПИСАН. Гость, приехавший издалека, читает «21°» и «01:58» как
      «здесь», а «здесь» у него своё: без подписи цифры отвечают не на тот
      вопрос. Подпись одна на весь блок — и градусы, и часы про одно место.
    */
    await expect(page.getByTestId('guest-home-city')).toHaveText(/\S+/)
  })

  test('города нет — подписи нет, а погода остаётся', async ({ page }) => {
    await homeAnswers(page, {
      weather: { temperature_c: 7, code: 3, is_day: true, observed_at: new Date().toISOString() },
      hotel: { name: 'Отель «Кристалл»', subdomain: 'crystal', timezone: 'Europe/Moscow' },
    })
    await enterRoom(page)

    await expect(page.getByTestId('guest-home-weather-now')).toBeVisible({ timeout: 15_000 })
    // Выдумывать город по координатам мы не станем: не заполнен — не показан.
    await expect(page.getByTestId('guest-home-city')).toHaveCount(0)
  })

  test('погоды нет — блока нет вовсе: ни прочерков, ни заглушек', async ({ page }) => {
    /*
      Часовой пояс прогона выставлен ЯВНО и равен отельному. Иначе проверка
      зависела бы от того, где стоит машина: часы отеля показываются и без
      погоды, но только гостю из другого пояса — тому, кому они что-то говорят.
    */
    await page.context().clearCookies()
    await homeAnswers(page, { weather: null })
    await enterRoom(page)
    await page.waitForTimeout(1200)

    await expect(page.getByTestId('guest-home-weather-now')).toHaveCount(0)
    await expect(page.getByTestId('guest-home-weather-attribution')).toHaveCount(0)
    // И ни одного «—» вместо градусов.
    await expect(page.getByTestId('guest-home')).not.toContainText('—°')
  })

  test('блока нет целиком, когда и погоды нет, и время у гостя то же', async ({ page }) => {
    await homeAnswers(page, {
      weather: null,
      hotel: { name: 'Отель «Кристалл»', subdomain: 'crystal', timezone: 'Europe/Moscow' },
    })
    await enterRoom(page)
    await page.waitForTimeout(1200)

    // Пустой стеклянный прямоугольник — это заглушка, которой не должно быть.
    await expect(page.getByTestId('guest-home-weather')).toHaveCount(0)
  })

  test('гостевое приложение к провайдеру не обращается', async ({ page }) => {
    /*
      СТОП-ПРАВИЛО ПРОДУКТА: погода приходит только с нашего сервера. Тысяча
      гостей в отеле — это тысяча обращений к чужому сервису с их IP, а у нас
      один вызов на отель раз в двадцать минут.
    */
    /*
      Ловим ОБРАЩЕНИЕ К ПРОВАЙДЕРУ, а не «всё наружу». Медиа отеля лежит в
      MinIO на другом хосте стенда, и запрет по хосту краснел бы на картинках
      меню; проверка по слову «weather» в адресе — на собственном исходнике
      `HomeWeather.tsx`. Признак ровно один: адрес провайдера погоды и его
      ручка прогноза.
    */
    const toProvider = (url: string) => {
      try {
        const parsed = new URL(url)
        return /open-meteo/i.test(parsed.hostname) || parsed.pathname.endsWith('/v1/forecast')
      } catch {
        return false
      }
    }
    const outside: string[] = []
    page.on('request', (request) => {
      if (toProvider(request.url())) outside.push(request.url())
    })

    await homeAnswers(page, {
      weather: { temperature_c: 5, code: 0, is_day: false, observed_at: new Date().toISOString() },
    })
    await enterRoom(page)
    await page.waitForTimeout(2000)

    expect(outside, `витрина сходила к провайдеру: ${outside.join(', ')}`).toEqual([])
  })

  test('местное время отеля идёт само, без перезагрузки страницы', async ({ page }) => {
    await homeAnswers(page, {
      weather: { temperature_c: 12, code: 3, is_day: true, observed_at: new Date().toISOString() },
      hotel: { name: 'Отель «Кристалл»', subdomain: 'crystal', timezone: 'Asia/Tokyo' },
    })
    await enterRoom(page)

    const clock = page.getByTestId('guest-home-clock')
    await expect(clock).toBeVisible({ timeout: 15_000 })

    // Часы отеля, а не устройства: Токио от прогона (ru-RU, UTC+3) отличается,
    // и совпадение здесь означало бы, что показывается время браузера.
    const shown = (await clock.textContent()) ?? ''
    const tokyo = new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Tokyo',
    }).format(new Date())
    expect(shown, 'на главной не местное время отеля').toContain(tokyo)
  })
})

test.describe('Главная: строка состояния номера', () => {
  test('строка берёт данные ИЗ СНИМКА НОМЕРА и ведёт на экран номера', async ({ page }) => {
    await enterRoom(page)

    const strip = page.getByTestId('guest-home-room-status')
    await expect(strip).toBeVisible({ timeout: 20_000 })

    /*
      ВТОРОГО ИСТОЧНИКА НЕТ. Сравниваем не картинку, а сами пилюли: строка на
      главной и строка на экране номера обязаны говорить одно и то же слово в
      слово — они читают один снимок одним кодом.
    */
    const onHome = await strip.getByTestId('room-pills').innerText()
    await strip.click()
    await expect(page.getByTestId('room-page')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('room-pills')).toBeVisible({ timeout: 20_000 })
    const onRoom = await page.getByTestId('room-pills').innerText()

    expect(onRoom.replace(/\s+/g, ' ').trim()).toBe(onHome.replace(/\s+/g, ' ').trim())
  })

  test('отель выключил строку — её нет, даже когда снимок есть', async ({ page }) => {
    await homeAnswers(page, { room_status: false })
    await enterRoom(page)
    await page.waitForTimeout(1500)

    await expect(page.getByTestId('guest-home-room-status')).toHaveCount(0)
  })

  test('оффлайн: строка говорит о недоступности, а не показывает старые значения', async ({
    page,
  }) => {
    await enterRoom(page)
    await expect(page.getByTestId('guest-home-room-status')).toBeVisible({ timeout: 20_000 })

    // Гасим канал и подменяем снимок на недоступный — тот же приём, что в
    // room-control: без глушения сокета живое состояние затирает подставленное.
    await page.routeWebSocket('**/ws/**', (ws) => ws.close())
    await page.route('**/api/v1/guest/room/state', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      await route.fulfill({
        response,
        json: {
          ...body,
          availability: 'unavailable',
          zones: (body.zones ?? []).map((zone: { controls: unknown[] }) => ({
            ...zone,
            controls: (zone.controls as { controlId: string }[]).map((control) => ({
              ...control,
              value: null,
              state: 'offline',
            })),
          })),
        },
      })
    })
    await page.reload()

    const strip = page.getByTestId('guest-home-room-status')
    await expect(strip).toBeVisible({ timeout: 20_000 })
    await expect(strip).toHaveAttribute('data-available', 'false')
    await expect(page.getByTestId('guest-home-room-offline')).toBeVisible()
    // Ни одной пилюли со значением: старое под видом текущего не показывается.
    await expect(strip.getByTestId('room-pills')).toHaveCount(0)
  })
})
