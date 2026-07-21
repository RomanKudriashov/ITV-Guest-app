import { defineConfig, devices } from '@playwright/test'

/**
 * E2E гоняются поверх УЖЕ поднятого стенда (`docker compose up`), а не
 * поднимают своё окружение: смысл этих тестов — проверить ровно ту сборку,
 * которую видит разработчик, вместе с настоящими бэкендом, БД и MinIO.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5183'

export default defineConfig({
  testDir: './tests',
  // Тесты пишут в общий каталог демо-отеля, поэтому строго последовательно:
  // параллельный прогон устроил бы гонку за порядок сортировки.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'ru-RU',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
})
