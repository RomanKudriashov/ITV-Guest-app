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
