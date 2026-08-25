import { defineConfig, devices } from '@playwright/test'

/**
 * Отдельная конфигурация съёмки: у набора проверок есть снимок стенда «до» и
 * уборка «после», и запускать их ради четырёх картинок незачем.
 *
 * Разрешение — десктопное 1440×900: снимки идут на лендинг, который смотрят и
 * с ноутбука тоже, а телефонный кроп на широком экране выглядит бедно.
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5183',
    locale: 'ru-RU',
    viewport: { width: 1440, height: 900 },
    // Снимки идут на страницу, которую открывают и с ретины: без этого текст
    // на них выглядит мыльным рядом с текстом самой страницы.
    deviceScaleFactor: 2,
  },
  projects: [{ name: 'chromium' }],
})
