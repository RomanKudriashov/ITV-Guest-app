import { expect, test } from './fixtures'

import { ADMIN, API, apiHeaders, apiToken, signIn } from './helpers'

/**
 * Город вместо координат (пункт 22). Отель вводил широту и долготу числами —
 * и не вводил: погоду включить было физически нельзя. Проверяем путь целиком:
 * набрал «Сочи» → выбрал → рядом сразу погода → сохранилось с переводами.
 *
 * Возвращаем прежний город в конце: настройка — состояние стенда.
 */
test('город выбирается подсказкой, координаты подставляются сами', async ({ page, request }) => {
  const token = await apiToken(request)
  const before = await (
    await request.get(`${API}/api/cms/home-settings`, { headers: apiHeaders(token) })
  ).json()

  try {
    await signIn(page, ADMIN)
    await page.goto('/cms/settings')
    await expect(page.getByTestId('cms-home-blocks')).toBeVisible({ timeout: 20_000 })

    // Координат на экране нет вовсе — их знает справочник.
    await expect(page.getByTestId('cms-home-latitude')).toHaveCount(0)
    await expect(page.getByTestId('cms-home-longitude')).toHaveCount(0)

    await page.getByTestId('cms-home-city-pick').fill('Сочи')
    const option = page.getByRole('option').filter({ hasText: 'Сочи' }).first()
    await expect(option).toBeVisible({ timeout: 20_000 })
    await option.click()

    // «Сейчас в Сочи +18, ясно» — ошибка выбора видна сразу.
    await expect(page.getByTestId('cms-home-weather-now')).toContainText(/Сочи/, { timeout: 20_000 })
    await expect(page.getByTestId('cms-home-weather-now')).toContainText(/°[CF]/)

    await page.getByTestId('cms-home-units').click()
    await page.getByTestId('cms-home-units-f').click()
    await expect(page.getByTestId('cms-home-units')).toContainText('Фаренгейт')
    // Ждём ОТВЕТ сервера, а не «кнопку нажали»: иначе проверка читает
    // настройки, пока сохранение ещё летит, и видит прежнее состояние.
    const savedResponse = page.waitForResponse(
      (r) => r.url().includes('/cms/home-settings') && r.request().method() === 'PUT',
    )
    await page.getByTestId('cms-home-blocks-save').click()
    expect((await savedResponse).status()).toBe(200)

    const saved = await (
      await request.get(`${API}/api/cms/home-settings`, { headers: apiHeaders(token) })
    ).json()
    expect(saved.city.ru).toBe('Сочи')
    expect(saved.city.en).toBe('Sochi')
    expect(saved.temperature_units).toBe('f')
    expect(saved.weather_available).toBe(true)
  } finally {
    await request.put(`${API}/api/cms/home-settings`, {
      data: {
        weather: before.weather,
        room_status: before.room_status,
        latitude: before.latitude,
        longitude: before.longitude,
        city: before.city,
        name: before.name,
        timezone: before.timezone,
        temperature_units: before.temperature_units,
      },
      headers: apiHeaders(token),
    })
  }
})

/**
 * АТРИБУЦИЯ ИСТОЧНИКА — условие лицензии, а не украшение.
 *
 * Данные Open-Meteo под CC BY 4.0: указание источника требуется на любом
 * плане. Подпись однажды сняли по указанию владельца продукта и вернули
 * 21.09.2026 решением встречи. Укус нужен, чтобы её не сняли в третий раз
 * «как лишнюю»: цена ошибки — нарушение лицензии, и по экрану это не видно.
 */
test('на витрине подписан источник погоды', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.goto('/')
  await page.getByTestId('guest-browse-only').click()
  await expect(page.getByTestId('guest-home')).toBeVisible({ timeout: 30_000 })

  const source = page.getByTestId('guest-home-weather-source')
  await expect(source, 'подпись источника пропала — это нарушение CC BY 4.0').toBeVisible({
    timeout: 30_000,
  })
  await expect(source).toContainText('Open-Meteo')

  // Стоит ВНИЗУ блока и мельче остального: выполнение лицензии, а не
  // сообщение гостю.
  const box = await source.boundingBox()
  const block = await page.getByTestId('guest-home-weather').boundingBox()
  expect(box!.y).toBeGreaterThan(block!.y)
  const size = await source.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))
  expect(size).toBeLessThanOrEqual(12)
})
