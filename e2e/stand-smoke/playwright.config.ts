import { defineConfig, devices } from '@playwright/test'

import { STAND } from './standBase'

/**
 * СМОКОВЫЙ НАБОР ДЛЯ СТЕНДА — свой проект, и это главное в нём.
 *
 * У основного набора есть снимок стенда «до» и уборка «после»: всё, чего до
 * прогона не было, считается созданным прогоном и удаляется. На своей машине
 * это спасает, на ПОКАЗНОМ стенде — оружие, направленное внутрь: чужая живая
 * работа, сделанная во время прогона, попадёт под уборку.
 *
 * Поэтому здесь нет ни `globalSetup`, ни `globalTeardown`. Убирать нечего,
 * потому что набор НИЧЕГО НЕ ПИШЕТ. Ровно два следа он всё-таки оставляет —
 * один вход сотрудника и одну гостевую сессию, то есть то же самое, что
 * оставляет любой человек, открывший панель и витрину. Из входа набор выходит
 * сам.
 *
 * Правило на будущее: если проверке понадобилась запись — её надо ВЫБРОСИТЬ,
 * а не приделывать к набору уборку. Один раз заведённая уборка однажды
 * сработает не вовремя.
 *
 *     # Пароль платформы смок берёт сам из ~/.config/itv-stand/platform-password
 *     # (права 600; переопределить — E2E_PLATFORM_PASSWORD или E2E_PLATFORM_PASSWORD_FILE).
 *     npm run smoke                                            # главная база (naviroom)
 *     E2E_STAND_BASE=app.147.45.245.172.sslip.io npm run smoke # второй прогон — sslip
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: STAND,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'ru-RU',
  },
  projects: [
    {
      name: 'stand',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // Метка прогона: вход смокового набора должен быть отличим от
        // настоящего человека в журнале входов.
        userAgent: `${devices['Desktop Chrome'].userAgent} ITV-SMOKE`,
      },
    },
  ],
})
