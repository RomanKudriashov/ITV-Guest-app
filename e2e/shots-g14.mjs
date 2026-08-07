/**
 * Съёмка плана номера с потоком воздуха — РУКАМИ, а не прогоном.
 *
 * Прогон в `docs/` больше не пишет (см. `tests/room-control-cms.spec.ts`):
 * кадры для документации снимает этот скрипт, запущенный осознанно.
 *
 * Кондиционер включается через тот же путь, что и у гостя, — нажатием на
 * экране. Класть состояние в базу мимо интерфейса значило бы снять кадр,
 * которого гость не увидит.
 *
 *     node shots-g14.mjs
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:5183'
const OUT = process.env.OUT ?? '../docs/design/g14-airflow'
const ROOM = process.env.ROOM ?? '305'

mkdirSync(path.resolve(OUT), { recursive: true })

const browser = await chromium.launch()

for (const mode of ['dark', 'light']) {
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
    locale: 'ru-RU',
  })
  const page = await context.newPage()

  await page.goto(BASE)
  await page.evaluate((m) => {
    window.localStorage.clear()
    window.localStorage.setItem('itv.theme-mode', m)
  }, mode)
  await page.goto(BASE)
  await page.getByTestId('guest-room-input').fill(ROOM)
  await page.getByTestId('guest-room-submit').click()
  await page.getByTestId('guest-nav-room').waitFor({ timeout: 25000 })
  await page.getByTestId('guest-nav-room').click()
  await page.getByTestId('room-plan').waitFor({ timeout: 25000 })

  const plate = page.getByTestId('room-plan')
  const air = page.locator('[data-testid^="room-plan-air-"]').first()

  // Выключенный кондиционер: потока нет, метка источника на месте.
  await page.getByTestId('room-tabs-climate').click()
  const power = page.getByTestId('room-control-ac.1')
  await power.waitFor({ timeout: 15000 })
  if ((await power.getAttribute('aria-pressed')) === 'true') {
    await power.click()
    await page.waitForTimeout(6000)
  }
  await air.waitFor({ timeout: 15000 })
  await plate.screenshot({ path: path.join(OUT, `plan-${mode}-off.png`) })

  // Включённый: струя от левой стены спальни в комнату.
  await power.click()
  await page.waitForTimeout(8000)
  await plate.screenshot({ path: path.join(OUT, `plan-${mode}-on.png`) })

  console.log(mode, 'снято:', await page.getByTestId('room-plan-airflow').getAttribute('data-flow'))
  await context.close()
}

await browser.close()
