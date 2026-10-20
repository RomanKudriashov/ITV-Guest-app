import { defineConfig, devices } from '@playwright/test'

/**
 * E2E гоняются поверх УЖЕ поднятого стенда (`docker compose up`), а не
 * поднимают своё окружение: смысл этих тестов — проверить ровно ту сборку,
 * которую видит разработчик, вместе с настоящими бэкендом, БД и MinIO.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5183'

/**
 * ПРОВЕРКИ, ПРАВЯЩИЕ НАСТРОЙКИ ОТЕЛЯ (бренд, главная, погода и единицы,
 * коммерция, плитки, точка главного) — на своём отеле прогона `e2e-hotel`
 * (партия 58в, `fixtures/e2eHotel.ts`). Демо-отели в e2e — только чтение
 * настроек; запись ловит сторож в `tests/fixtures.ts`. Новую такую проверку —
 * сюда же, иначе она покраснеет на стороже.
 */
const OWN_HOTEL_SPECS = [
  'brand-accent-and-surface',
  'brand-backdrop',
  'brand-background-one-file',
  'brand-cover-sharpness',
  'brand-custom-font',
  'brand-drafts-and-versions',
  'brand-font-everywhere',
  'brand-font-formats',
  'brand-fonts-on-guest',
  'brand-heading-weight',
  'brand-logo',
  'brand-preview-entry-draft',
  'brand-preview-parity',
  'brand-schedule',
  'brand-surface-cards',
  'brand-text-size-and-colour',
  'brand-type-scale',
  'brand',
  'catalog-tabs-big-menu',
  'catalog-lazy-images',
  'commerce-checkout',
  'desktop-logo-or-name',
  'guest-no-horizontal-scroll',
  'image-focus',
  'phone-topbar-overlap',
  'showcase-flow',
  'weather-city',
].map((name) => new RegExp(`/${name}\\.spec\\.ts$`))

export default defineConfig({
  testDir: './tests',
  // Стенд общий и живёт между прогонами, поэтому у набора есть снимок «до» и
  // уборка «после»: всё, чего до прогона не было, создано им и убирается.
  // Это правило не зависит от имён — угадывание «E2E …» ломается о первый
  // настоящий отель, названный похоже.
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
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
      testIgnore: OWN_HOTEL_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // Метка прогона в строке браузера. Прогон сам выходит из своих входов,
        // а уборка стенда по этой метке подбирает то, что выход пропустил:
        // без неё профиль «Desktop Chrome» неотличим от настоящего Chrome.
        userAgent: `${devices['Desktop Chrome'].userAgent} ITV-E2E`,
      },
    },
    {
      name: 'own-hotel',
      testMatch: OWN_HOTEL_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        userAgent: `${devices['Desktop Chrome'].userAgent} ITV-E2E`,
        ownHotel: true,
      },
    },
  ],
})
