import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { DEMO_ROOM } from './helpers'

/**
 * ЭКРАН ПОГОДЫ (партия 65): нажатие на погоду на главной ведёт на подробный
 * экран — сейчас и по часам, 7 и 16 дней, ориентир до 46 дней, полгода по
 * месяцам, море и воздух.
 *
 * Данные — настоящим путём: сервер собирает их в фоне у эмулятора Open-Meteo
 * (тот же HTTP, что у провайдера), экран переспрашивает, пока они «в пути».
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

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('погода на главной ведёт на экран погоды со всеми горизонтами', async ({ page }) => {
  test.setTimeout(120_000)
  await enterRoom(page)
  const block = page.getByTestId('guest-home-weather')
  await expect(block).toBeVisible({ timeout: 30_000 })
  await block.click()
  await expect(page).toHaveURL(/\/weather$/)

  // Сбор идёт в фоне: первый ответ может быть «в пути», экран переспрашивает сам.
  await expect(page.getByTestId('guest-weather-now')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('guest-weather-now-temp')).toContainText('°')
  await expect(page.getByTestId('guest-weather-hour').first()).toBeVisible()
  await expect(page.getByTestId('guest-weather-wind')).toBeVisible()
  await expect(page.getByTestId('guest-weather-sea')).toBeVisible()
  await expect(page.getByTestId('guest-weather-air')).toBeVisible()
  // Атрибуция — условие лицензии Open-Meteo, на экране погоды она обязана быть.
  await expect(page.getByTestId('guest-weather-source')).toContainText('Open-Meteo')

  await page.getByTestId('guest-weather-range-week').click()
  await expect(page.getByTestId('guest-weather-day')).toHaveCount(7)
  await page.getByTestId('guest-weather-range-fortnight').click()
  await expect(page.getByTestId('guest-weather-day')).toHaveCount(16)
  await page.getByTestId('guest-weather-range-month').click()
  // После 16 дней — ориентир по ансамблю, днями до 46-го.
  await expect(page.getByTestId('guest-weather-outlook')).toBeVisible()
  expect(await page.getByTestId('guest-weather-outlook-day').count()).toBeGreaterThanOrEqual(25)
  await page.getByTestId('guest-weather-range-season').click()
  await expect(page.getByTestId('guest-weather-month')).toHaveCount(6)

  await page.getByTestId('guest-weather-back').click()
  await expect(page.getByTestId('guest-home')).toBeVisible()
})

test('провайдер молчит — честное «погоды пока нет», а не пустой экран', async ({ page }) => {
  await page.route('**/guest/weather**', (route) =>
    route.fulfill({ json: { enabled: true, pending: false, city: 'Москва', timezone: 'Europe/Moscow', weather: null } }),
  )
  await enterRoom(page)
  await page.goto('/weather')
  await expect(page.getByTestId('guest-weather-empty')).toBeVisible({ timeout: 20_000 })
})

test('поиск города: только города, погода выбранного города и возврат к отелю', async ({ page }) => {
  test.setTimeout(120_000)
  await enterRoom(page)
  await page.goto('/weather')
  await expect(page.getByTestId('guest-weather-now')).toBeVisible({ timeout: 60_000 })
  const hotelCity = await page.getByTestId('guest-weather-city').innerText()

  // Подсказки — через наш сервер (ключ DaData в браузер не попадает).
  const cities = page.waitForRequest((request) => request.url().includes('/guest/weather/cities'))
  await page.getByTestId('guest-weather-search').fill('Дуб')
  expect((await cities).url()).not.toContain('dadata')
  const option = page.getByTestId('guest-weather-city-option').first()
  await expect(option).toContainText('Дубай', { timeout: 15_000 })
  await option.click()

  // Город — в адресе страницы: «назад» и обновление показывают его же.
  await expect(page).toHaveURL(/[?&]lat=25\.\d+&lon=55\.\d+/)
  await expect(page.getByTestId('guest-weather-city')).toHaveText('Дубай')
  await expect(page.getByTestId('guest-weather-now')).toBeVisible({ timeout: 60_000 })
  await page.reload()
  await expect(page.getByTestId('guest-weather-city')).toHaveText('Дубай', { timeout: 20_000 })

  await page.getByTestId('guest-weather-hotel').click()
  await expect(page.getByTestId('guest-weather-city')).toHaveText(hotelCity)
  await expect(page.getByTestId('guest-weather-hotel')).toHaveCount(0)
})
