import { expect, test, type Page } from '@playwright/test'

import { ADMIN, CREDENTIALS, DEMO_ROOM, login, loginToTracker } from './helpers'
import { STORAGE_KEYS } from '../fixtures/appState'

/**
 * R7: обе темы на ВСЕХ поверхностях.
 *
 * Проверяем два разных факта, и их нельзя путать:
 *
 *  1. ПЕРЕКЛЮЧЕНИЕ РАБОТАЕТ — тумблер меняет тему по-настоящему, то есть
 *     меняется фон реальной поверхности, а не только иконка тумблера. До R7
 *     витрина и админка брали цвет из плоских тёмных литералов: режим
 *     переключался, а экран оставался прежним — и «тема есть» было бы верно
 *     ровно до первого взгляда.
 *
 *  2. ТЕМА ОТЕЛЯ ДОХОДИТ ДО ПЕРСОНАЛА — CMS и трекер открываются в БРЕНДЕ
 *     ОТЕЛЯ (демо-отель тёмный), а не в платформенном дефолте. Это КОРЕНЬ-1:
 *     провайдер темы стоял без токенов, и обе поверхности работали светлыми с
 *     чужим акцентом.
 *
 * Тема хранится в localStorage, поэтому каждый тест начинает с чистого листа —
 * иначе выбор предыдущего теста утёк бы в следующий.
 */

/** Фон страницы как его реально видно. */
async function pageBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor)
}

/** Яркость цвета `rgb(...)`: по ней отличаем светлую поверхность от тёмной. */
function luminance(color: string): number {
  const [r, g, b] = (color.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).map(Number)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Забыть выбор темы ОДИН раз, до начала теста.
 *
 * Именно `evaluate` после первой навигации, а не `addInitScript`: тот
 * выполняется на КАЖДОЙ навигации, в том числе на перезагрузке внутри теста —
 * и стирал бы ровно тот выбор, сохранность которого мы проверяем.
 */
async function clearTheme(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate((key) => {
    try {
      window.localStorage.removeItem(key)
    } catch {
      /* приватный режим — выбора и так нет */
    }
  }, STORAGE_KEYS.theme)
}

async function enterAsGuest(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('guest-room-input').fill(DEMO_ROOM)
  await page.getByTestId('guest-room-submit').click()
  await expect(page.getByTestId('guest-home-bento')).toBeVisible({ timeout: 15_000 })
}

/**
 * Переключить тему и дождаться, пока фон РЕАЛЬНО сменит светлоту.
 * Возвращает пару «было / стало».
 */
async function toggleAndMeasure(page: Page): Promise<{ before: number; after: number }> {
  const before = luminance(await pageBackground(page))
  await page.getByTestId('theme-toggle').first().click()
  await expect
    .poll(async () => luminance(await pageBackground(page)), { timeout: 10_000 })
    .not.toBe(before)
  return { before, after: luminance(await pageBackground(page)) }
}

test.describe('Тема: переключение на всех поверхностях', () => {
  test('витрина гостя переключается и запоминает выбор', async ({ page }) => {
    await clearTheme(page)
    await enterAsGuest(page)

    // Демо-отель тёмный: гость открывает витрину в брендовой тёмной теме.
    const dark = luminance(await pageBackground(page))
    expect(dark, 'демо-отель midnight_navy — витрина открывается тёмной').toBeLessThan(90)

    const { after: light } = await toggleAndMeasure(page)
    expect(light, 'после тумблера витрина светлая').toBeGreaterThan(dark)

    // Чип номера — тот самый элемент, который до R7 оставался тёмным островом
    // на светлой строке: у него был жёстко белый текст на белесой подложке.
    const chip = page.getByTestId('guest-room-chip').first()
    if (await chip.isVisible()) {
      const chipInk = await chip.evaluate((node) => getComputedStyle(node).color)
      expect(luminance(chipInk), 'на светлой теме текст чипа тёмный').toBeLessThan(140)
    }

    // Выбор переживает перезагрузку — иначе тумблер не выбор, а мигание.
    await page.reload()
    await expect(page.getByTestId('guest-home-bento')).toBeVisible({ timeout: 15_000 })
    expect(luminance(await pageBackground(page))).toBeGreaterThan(dark)
  })

  test('экран управления номером живёт в обеих темах', async ({ page }) => {
    await clearTheme(page)
    await enterAsGuest(page)

    await page.getByTestId('guest-nav-room').click()
    await expect(page.getByTestId('room-page')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('room-control-light.living')).toBeVisible({ timeout: 20_000 })

    const dark = luminance(await pageBackground(page))
    expect(dark, 'демо-отель тёмный — экран номера открывается тёмным').toBeLessThan(90)

    // Плитка контрола обязана взять цвет из ТОКЕНОВ, а не остаться тёмным
    // островом: ровно этой болезнью болели чип номера и нижнее меню до R7.
    const tileInk = await page
      .getByTestId('room-control-light.living')
      .evaluate((node) => getComputedStyle(node).color)

    const { after: light } = await toggleAndMeasure(page)
    expect(light, 'после тумблера экран номера светлый').toBeGreaterThan(dark)

    const tileInkLight = await page
      .getByTestId('room-control-light.living')
      .evaluate((node) => getComputedStyle(node).color)
    expect(tileInkLight, 'текст плитки обязан смениться вместе с темой').not.toBe(tileInk)
    expect(luminance(tileInkLight), 'на светлой теме текст плитки тёмный').toBeLessThan(150)
  })

  test('CMS открывается в бренде отеля и переключается', async ({ page }) => {
    await clearTheme(page)
    await login(page, ADMIN)

    // КОРЕНЬ-1: до R7 здесь была белая страница на платформенном дефолте.
    const dark = luminance(await pageBackground(page))
    expect(dark, 'CMS открывается в тёмном бренде отеля, а не в дефолте').toBeLessThan(90)

    const { after } = await toggleAndMeasure(page)
    expect(after, 'светлая CMS светлее тёмной').toBeGreaterThan(dark)
  })

  test('трекер открывается в бренде отеля и переключается', async ({ page }) => {
    await clearTheme(page)
    await loginToTracker(page, CREDENTIALS)

    const dark = luminance(await pageBackground(page))
    expect(dark, 'трекер открывается в тёмном бренде отеля').toBeLessThan(90)

    const { after } = await toggleAndMeasure(page)
    expect(after, 'светлый трекер светлее тёмного').toBeGreaterThan(dark)
  })
})
