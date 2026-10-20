import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'

import { API, HOTEL } from './helpers'
import { E2E_HOTEL } from '../fixtures/e2eHotel'

/**
 * ВКЛАДКИ РАЗДЕЛОВ НА БОЛЬШОМ МЕНЮ (партия 61).
 *
 * Разделы ниже экрана не раскладываются (`content-visibility`) и стоят
 * заглушкой. Плавная прокрутка к дальнему разделу проходила через заглушки,
 * они раскладывались в настоящую высоту — и вкладка «уезжала» на тысячи
 * пикселей мимо начала раздела, подсвечивалась не та. Проверка — на меню
 * размером с ресторан Метрополя, на своём отеле прогона.
 */

const VENUE = 'big-tabs'
const LINE_TOLERANCE = 2

test.beforeAll(async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  await promisify(execFile)(
    'docker',
    ['compose', 'exec', '-T', 'backend', 'python', 'manage.py', 'seed_big_menu',
      '--subdomain', E2E_HOTEL, '--service', VENUE, '--categories', '30', '--items', '240'],
    { cwd: process.cwd() + '/..', timeout: 300_000 },
  )
})

async function openBigMenu(page: Page, width: number, height: number): Promise<string[]> {
  await page.setViewportSize({ width, height })
  const session = await (
    await page.request.post(`${API}/api/guest/session`, {
      data: { room_number: '305', language: 'ru' },
      headers: { 'X-Hotel-Subdomain': HOTEL },
    })
  ).json()
  await page.addInitScript((token) => window.localStorage.setItem('itv.guest.token', token), session.token)
  await page.goto(`/venue/${VENUE}`)
  await expect(page.locator('[data-menu-view]')).toBeVisible({ timeout: 60_000 })
  return page
    .locator('[data-testid^="guest-category-tab-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('guest-category-tab-', '')))
}

/** Где заголовок раздела относительно низа строки вкладок, и какая вкладка подсвечена. */
async function where(page: Page, code: string) {
  return page.evaluate((target) => {
    const tab = document.querySelector(`[data-testid="guest-category-tab-${target}"]`)!
    const tabs = tab.closest('[role="tablist"]')!.getBoundingClientRect()
    const section = [...document.querySelectorAll('section[aria-label]')].find(
      (node) => node.getAttribute('aria-label') === tab.textContent,
    )!
    const selected = document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-testid')
    return { offset: Math.round(section.getBoundingClientRect().top - tabs.bottom), selected }
  }, code)
}

for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`${width}: вкладка ведёт ТОЧНО к началу раздела, подсветка следует прокрутке`, async ({ page }) => {
    test.setTimeout(240_000)
    const codes = await openBigMenu(page, width, height)
    expect(codes.length).toBeGreaterThan(20)

    for (const index of [2, 9, 18, codes.length - 1, 4, 0]) {
      await page.getByTestId(`guest-category-tab-${codes[index]}`).click()
      await expect
        .poll(async () => (await where(page, codes[index])).offset, {
          timeout: 5_000,
          message: `${width}: вкладка №${index + 1} не довела до начала раздела`,
        })
        .toBeLessThanOrEqual(LINE_TOLERANCE)
      const settled = await where(page, codes[index])
      expect(Math.abs(settled.offset), `${width}: вкладка №${index + 1}`).toBeLessThanOrEqual(LINE_TOLERANCE)
      expect(settled.selected).toBe(`guest-category-tab-${codes[index]}`)
    }

    // Обычная прокрутка: подсвечен тот раздел, чьё начало прошло под строкой вкладок.
    await page.getByTestId(`guest-category-tab-${codes[5]}`).click()
    await page.waitForTimeout(400)
    for (let step = 0; step < 6; step++) {
      await page.mouse.wheel(0, height * 0.7)
      await page.waitForTimeout(300)
      const state = await page.evaluate(() => {
        const tabs = document.querySelector('[role="tablist"]')!.getBoundingClientRect()
        const sections = [...document.querySelectorAll('section[aria-label]')]
        let current = sections[0]
        for (const node of sections) if (node.getBoundingClientRect().top <= tabs.bottom + 8) current = node
        const selected = document.querySelector('[role="tab"][aria-selected="true"]')?.textContent
        return { expected: current.getAttribute('aria-label'), selected }
      })
      expect(state.selected, `${width}: шаг прокрутки ${step + 1}`).toBe(state.expected)
    }
  })
}
