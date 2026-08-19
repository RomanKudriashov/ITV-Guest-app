import { chromium } from '@playwright/test'
import fs from 'node:fs'

/**
 * Снимки «до/после» для задачи единого визуального языка консоли и CMS.
 * Только чтение и открытие диалогов — ничего не сохраняет.
 */
const BASE = process.env.BASE ?? 'http://localhost:5183'
const OUT = process.env.OUT ?? './shots'
const THEME_KEY = 'itv.theme-mode'
const PLATFORM = { email: 'platform@itv.local', password: 'platform12345' }
const CMS = { email: 'owner@crystal.local', password: 'chef12345' }

fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const notes = []

async function ctxFor(theme) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    deviceScaleFactor: 1,
  })
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [THEME_KEY, theme])
  return ctx
}

async function shot(page, name) {
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' })
}

async function consolePass(theme) {
  const ctx = await ctxFor(theme)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => notes.push(`[${theme}] исключение: ${String(e).slice(0, 160)}`))

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('admin-login').waitFor({ timeout: 20000 })
  await shot(page, `console-01-login-${theme}`)

  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await page.getByTestId('admin-shell').waitFor({ timeout: 25000 })
  await page.waitForTimeout(2500)
  await shot(page, `console-02-overview-${theme}`)

  // Меню профиля в шапке
  const profile = page.getByTestId('admin-profile-button')
  if (await profile.count()) {
    await profile.click()
    await page.waitForTimeout(900)
    await shot(page, `console-02b-profile-menu-${theme}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  } else {
    notes.push(`[${theme}] нет admin-profile-button`)
  }

  // Отели
  await page.getByTestId('admin-nav-fleet').click()
  await page.waitForTimeout(2200)
  await shot(page, `console-03-fleet-${theme}`)

  // Диалог заведения отеля
  const createBtn = page.getByTestId('admin-create-open')
  if (await createBtn.count()) {
    await createBtn.first().click()
    await page.getByTestId('admin-create-dialog').waitFor({ timeout: 8000 }).catch(() => {})
    await shot(page, `console-04-dialog-create-hotel-${theme}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
  } else {
    notes.push(`[${theme}] нет кнопки admin-create-open`)
  }

  // Карточка отеля + диалог входа в отель
  const opener = page.locator('[data-testid^="admin-fleet-open-"]').first()
  if (await opener.count()) {
    await opener.click()
    await page.waitForTimeout(2500)
    await shot(page, `console-05-hotel-${theme}`)
    const enter = page.getByTestId('admin-hotel-enter')
    if (await enter.count()) {
      await enter.first().click()
      await page.getByTestId('admin-enter-dialog').waitFor({ timeout: 8000 }).catch(() => {})
      await shot(page, `console-06-dialog-enter-hotel-${theme}`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(600)
    } else {
      notes.push(`[${theme}] нет кнопки admin-hotel-enter`)
    }
  } else {
    notes.push(`[${theme}] флот пуст`)
  }

  // Узлы + форма заведения узла
  await page.getByTestId('admin-nav-nodes').click()
  await page.waitForTimeout(2200)
  await shot(page, `console-07-nodes-${theme}`)
  const nodeCreate = page.getByTestId('admin-node-create')
  if (await nodeCreate.count()) {
    await nodeCreate.first().click()
    await page.waitForTimeout(1200)
    await shot(page, `console-08-node-form-${theme}`)
  } else {
    notes.push(`[${theme}] нет кнопки admin-node-create`)
  }

  for (const [key, index] of [['team', 9], ['security', 10], ['audit', 11], ['modules', 12], ['templates', 13], ['support', 14]]) {
    const nav = page.getByTestId(`admin-nav-${key}`)
    if (!(await nav.count())) { notes.push(`[${theme}] нет раздела ${key}`); continue }
    await nav.click()
    await page.waitForTimeout(2000)
    await shot(page, `console-${String(index).padStart(2, '0')}-${key}-${theme}`)
  }

  await ctx.close()
}

async function cmsPass(theme) {
  const ctx = await ctxFor(theme)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => notes.push(`[cms ${theme}] исключение: ${String(e).slice(0, 160)}`))

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('login-email').waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)
  await shot(page, `cms-01-login-${theme}`)

  await page.getByTestId('login-email').fill(CMS.email)
  await page.getByTestId('login-password').fill(CMS.password)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/cms\//, { timeout: 25000 })
  await page.waitForTimeout(2500)
  await shot(page, `cms-02-dashboard-${theme}`)

  const cmsProfile = page.getByTestId('cms-profile-button')
  if (await cmsProfile.count()) {
    await cmsProfile.click()
    await page.waitForTimeout(900)
    await shot(page, `cms-02b-profile-menu-${theme}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  } else {
    notes.push(`[cms ${theme}] нет cms-profile-button`)
  }

  await page.goto(`${BASE}/cms/staff`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await shot(page, `cms-03-staff-${theme}`)
  const add = page.getByTestId('staff-add')
  if (await add.count()) {
    await add.first().click()
    await page.getByTestId('staff-dialog').waitFor({ timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(1200)
    await shot(page, `cms-04-staff-dialog-${theme}`)
    await page.keyboard.press('Escape')
  } else {
    notes.push(`[cms ${theme}] нет staff-add`)
  }

  await ctx.close()
}

for (const theme of ['light', 'dark']) {
  await consolePass(theme)
  await cmsPass(theme)
}

await browser.close()
console.log(notes.length ? `ЗАМЕТКИ:\n${notes.join('\n')}` : 'без замечаний')
console.log(`кадров: ${fs.readdirSync(OUT).length}`)
