import { chromium } from '@playwright/test'

/**
 * Контраст ЖИВОГО экрана, а не словаря.
 *
 * Обходит каждый видимый текстовый узел консоли, берёт вычисленный цвет и
 * реальную подложку (поднимаясь по предкам до первого непрозрачного фона и
 * складывая полупрозрачные слои), считает WCAG 2.1 и сравнивает с порогом:
 * 3:1 для крупного (≥24px, или ≥18.66px при весе ≥700), иначе 4.5:1.
 *
 * Словарь может быть безупречен и при этом не дойти до экрана — ровно это и
 * случилось с диалогами, где переменные не пересекали границу портала.
 */
const BASE = process.env.BASE ?? 'http://localhost:5183'
const THEME_KEY = 'itv.theme-mode'
const PLATFORM = { email: 'platform@itv.local', password: 'platform12345' }
const SECTIONS = ['overview', 'fleet', 'modules', 'nodes', 'templates', 'team', 'support', 'security', 'audit']

const AUDIT = () => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return [0, 0, 0, 0]
    const p = m[1].split(',').map((s) => parseFloat(s))
    return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]
  }
  const lum = ([r, g, b]) => {
    const f = (v) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]))

  // Эффективная подложка: вверх по предкам, складывая полупрозрачные слои.
  const backdrop = (el) => {
    const layers = []
    let node = el
    while (node && node !== document.documentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor)
      if (bg[3] > 0) {
        layers.push(bg)
        if (bg[3] === 1) break
      }
      node = node.parentElement
    }
    const root = parse(getComputedStyle(document.documentElement).backgroundColor)
    let base = root[3] === 1 ? [root[0], root[1], root[2]] : [255, 255, 255]
    for (let i = layers.length - 1; i >= 0; i -= 1) base = over(layers[i], base)
    return base
  }

  const out = []
  const seen = new Set()
  for (const el of document.querySelectorAll('body *')) {
    // Только узлы с СОБСТВЕННЫМ текстом: иначе один и тот же текст считается
    // на каждом предке.
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim())
      .join(' ')
    if (!own) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.15) continue

    const size = parseFloat(cs.fontSize)
    const weight = parseInt(cs.fontWeight, 10) || 400
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    const need = large ? 3 : 4.5

    const fgRaw = parse(cs.color)
    if (fgRaw[3] === 0) continue
    const bg = backdrop(el)
    const fg = over(fgRaw, bg)
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
    const ratio = (a + 0.05) / (b + 0.05)

    const key = `${own.slice(0, 40)}|${Math.round(ratio * 100)}`
    if (seen.has(key)) continue
    seen.add(key)
    if (ratio < need) {
      out.push({
        text: own.slice(0, 46),
        ratio: Number(ratio.toFixed(2)),
        need,
        size,
        weight,
        color: cs.color,
      })
    }
  }
  return out.sort((x, y) => x.ratio - y.ratio)
}

const browser = await chromium.launch()
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' })
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEME_KEY, theme])
  const page = await ctx.newPage()

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('admin-login-email').waitFor()
  await page.waitForTimeout(1200)
  const all = []
  const collect = (where, rows) => rows.forEach((r) => all.push({ where, ...r }))

  collect('вход', await page.evaluate(AUDIT))

  await page.getByTestId('admin-login-email').fill(PLATFORM.email)
  await page.getByTestId('admin-login-password').fill(PLATFORM.password)
  await page.getByTestId('admin-login-submit').click()
  await page.getByTestId('admin-shell').waitFor()
  await page.waitForTimeout(2500)

  for (const key of SECTIONS) {
    await page.getByTestId(`admin-nav-${key}`).click()
    await page.waitForTimeout(1800)
    collect(key, await page.evaluate(AUDIT))
  }

  await page.getByTestId('admin-profile-button').click()
  await page.waitForTimeout(700)
  collect('меню профиля', await page.evaluate(AUDIT))
  await page.keyboard.press('Escape')

  await page.getByTestId('admin-nav-fleet').click()
  await page.waitForTimeout(1800)
  await page.getByTestId('admin-create-open').click()
  await page.getByTestId('admin-create-dialog').waitFor()
  await page.waitForTimeout(1000)
  collect('диалог «Новый отель»', await page.evaluate(AUDIT))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)

  const opener = page.locator('[data-testid^="admin-fleet-open-"]').first()
  await opener.click()
  await page.waitForTimeout(2200)
  collect('карточка отеля', await page.evaluate(AUDIT))
  await page.getByTestId('admin-hotel-enter').click()
  await page.getByTestId('admin-enter-dialog').waitFor()
  await page.waitForTimeout(900)
  collect('диалог «Вход в отель»', await page.evaluate(AUDIT))

  console.log(`\n===== ${theme.toUpperCase()} =====`)
  if (!all.length) console.log('ниже порога: НЕТ')
  else {
    const uniq = []
    const seen = new Set()
    for (const r of all.sort((a, b) => a.ratio - b.ratio)) {
      const k = `${r.text}|${r.ratio}`
      if (seen.has(k)) continue
      seen.add(k)
      uniq.push(r)
    }
    for (const r of uniq) {
      console.log(
        ` ${String(r.ratio).padStart(5)} : ${r.need}  [${r.where}] «${r.text}» ${r.size}px/${r.weight} ${r.color}`,
      )
    }
    console.log(`всего ниже порога: ${uniq.length}`)
  }
  await ctx.close()
}
await browser.close()
