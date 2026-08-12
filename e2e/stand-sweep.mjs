import { chromium } from '@playwright/test'
import { STORAGE_KEYS } from './fixtures/appState.mjs'
import fs from 'node:fs'

/**
 * Обход стенда глазами: гость, панель отеля и платформенная консоль в двух
 * темах, на четырёх языках, на телефоне и десктопе.
 *
 * Скрипт НИЧЕГО НЕ СОЗДАЁТ — только открывает экраны. Стенд общий, и обход,
 * оставляющий за собой заказы, пришлось бы потом разгребать.
 *
 * Ловит не «страница открылась», а три вещи, которые видно только в браузере:
 * ошибки в консоли, неудавшиеся запросы и пустой экран там, где должно быть
 * содержимое. Скриншоты складываются рядом — их всё равно надо посмотреть
 * глазами, автоматика не отличит «криво сверстано» от «нормально».
 */
const BASE = process.env.BASE ?? 'https://crystal.app.147.45.245.172.sslip.io'
const PLATFORM = process.env.PLATFORM ?? 'https://app.147.45.245.172.sslip.io'
const OUT = process.env.OUT ?? './stand-shots'
const ROOM = process.env.ROOM ?? '401'
const STAFF = { email: 'owner@crystal.local', password: 'chef12345' }
const OWNER = { email: 'owner@itv.local', password: 'oedykG4u0wNYKlwzTY' }

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
}

fs.mkdirSync(OUT, { recursive: true })
const problems = []
const browser = await chromium.launch()

/** Контекст с перехватом ошибок: они и есть улов. */
async function open(viewport, { theme = 'dark', locale = 'ru-RU' } = {}) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    locale,
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
  })
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`консоль: ${m.text().slice(0, 200)}`)
  })
  page.on('pageerror', (e) => problems.push(`исключение: ${String(e).slice(0, 200)}`))
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url().slice(0, 140)}`)
  })
  return { ctx, page, theme }
}

async function setTheme(page, theme) {
  await page.evaluate(([key, value]) => {
    localStorage.setItem(key, value)
  }, [STORAGE_KEYS.theme, theme])
}

async function shot(page, name) {
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled', fullPage: false })
}

/** Не пусто ли: у экрана должен быть видимый текст, а не белый лист. */
async function notBlank(page, name) {
  const text = (await page.locator('body').innerText().catch(() => '')) || ''
  if (text.trim().length < 40) problems.push(`пустой экран: ${name}`)
}

// --- Гость: 2 темы × 4 языка × 2 ширины -----------------------------------
for (const viewport of ['phone', 'desktop']) {
  for (const theme of ['dark', 'light']) {
    for (const lang of ['ru', 'en', 'ar', 'zh']) {
      const locale = lang === 'zh' ? 'zh-CN' : lang === 'ar' ? 'ar' : `${lang}-RU`
      const { ctx, page } = await open(viewport, { theme, locale })
      const tag = `guest-${viewport}-${theme}-${lang}`
      try {
        await page.goto(BASE, { waitUntil: 'domcontentloaded' })
        await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
        await setTheme(page, theme)
        await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'domcontentloaded' })
        await page.getByTestId('guest-room-input').fill(ROOM)
        await page.getByTestId('guest-room-submit').click()
        await page.getByTestId('guest-home').waitFor({ timeout: 30000 })
        await notBlank(page, `${tag} главная`)
        await shot(page, `${tag}-home`)

        // Русский комплект снимаем целиком, прочие языки — только главную:
        // остальные экраны отличаются подписями, а не раскладкой, и десять
        // одинаковых обходов ничего нового не показывают.
        if (lang === 'ru') {
          await page.goto(`${BASE}/search?q=салат`, { waitUntil: 'domcontentloaded' })
          await shot(page, `${tag}-search`)
          await page.goto(`${BASE}/orders`, { waitUntil: 'domcontentloaded' })
          await notBlank(page, `${tag} история заказов`)
          await shot(page, `${tag}-orders`)
          await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' })
          await shot(page, `${tag}-chat`)
          await page.goto(`${BASE}/room`, { waitUntil: 'domcontentloaded' })
          await shot(page, `${tag}-room`)
        }
      } catch (e) {
        problems.push(`${tag}: ${String(e).slice(0, 200)}`)
      }
      await ctx.close()
    }
  }
}

// --- Панель отеля ----------------------------------------------------------
for (const viewport of ['desktop', 'phone']) {
  for (const theme of ['dark', 'light']) {
    const { ctx, page } = await open(viewport, { theme })
    const tag = `cms-${viewport}-${theme}`
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
      await setTheme(page, theme)
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
      await page.locator('input[type="email"], input[name="email"]').first().fill(STAFF.email)
      await page.locator('input[type="password"]').first().fill(STAFF.password)
      await page.locator('button[type="submit"]').first().click()
      await page.waitForTimeout(3500)
      await notBlank(page, `${tag} вход`)
      await shot(page, `${tag}-after-login`)

      for (const [name, path] of [
        ['dashboard', '/cms/dashboard'],
        ['analytics', '/cms/analytics'],
        ['services', '/cms/services'],
        ['menu', '/cms/menu'],
        ['rooms', '/cms/rooms'],
        ['staff', '/cms/staff'],
        ['brand', '/cms/brand'],
        ['showcase', '/cms/showcase'],
        ['commerce', '/cms/commerce'],
        ['marketing', '/cms/marketing'],
        ['room-control', '/cms/room-control'],
        ['locations', '/cms/locations'],
        ['departments', '/cms/departments'],
        ['settings', '/cms/settings'],
        ['notifications', '/cms/notifications'],
      ]) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(2500)
        await notBlank(page, `${tag} ${name}`)
        await shot(page, `${tag}-${name}`)
      }
    } catch (e) {
      problems.push(`${tag}: ${String(e).slice(0, 200)}`)
    }
    await ctx.close()
  }
}

// --- Платформенная консоль -------------------------------------------------
for (const theme of ['dark', 'light']) {
  const { ctx, page } = await open('desktop', { theme })
  const tag = `platform-${theme}`
  try {
    await page.goto(`${PLATFORM}/admin`, { waitUntil: 'domcontentloaded' })
    await setTheme(page, theme)
    await page.goto(`${PLATFORM}/admin`, { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="email"], input[name="email"]').first().fill(OWNER.email)
    await page.locator('input[type="password"]').first().fill(OWNER.password)
    await page.locator('button[type="submit"]').first().click()
    await page.waitForTimeout(3500)
    await notBlank(page, `${tag} консоль`)
    await shot(page, `${tag}-console`)
    // Разделы консоли живут в состоянии, а не в маршруте (см. AdminApp):
    // ссылки на них нет, переключаться надо кликом по пункту меню.
    for (const label of ['Флот', 'Модули', 'Узлы', 'Шаблоны', 'Команда', 'Аудит']) {
      const item = page.getByRole('button', { name: label }).first()
      if (!(await item.count())) {
        problems.push(`консоль: нет пункта меню «${label}»`)
        continue
      }
      await item.click()
      await page.waitForTimeout(2500)
      await notBlank(page, `${tag} ${label}`)
      await shot(page, `${tag}-${label}`)
    }
  } catch (e) {
    problems.push(`${tag}: ${String(e).slice(0, 200)}`)
  }
  await ctx.close()
}

await browser.close()

// Одинаковые жалобы схлопываем: одна сломанная картинка на витрине даёт
// столько строк, сколько раз её открыли, и в этом шуме тонет остальное.
const counted = new Map()
for (const p of problems) counted.set(p, (counted.get(p) ?? 0) + 1)
console.log(`\nснимки: ${OUT}`)
console.log(`замечаний: ${problems.length} (уникальных ${counted.size})`)
for (const [text, n] of [...counted].sort((a, b) => b[1] - a[1])) {
  console.log(`  ×${n}  ${text}`)
}
