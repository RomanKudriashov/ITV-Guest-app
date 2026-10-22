import { type APIRequestContext, type Page } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import { expect, test } from './fixtures'

import { API, PLATFORM, signInPlatform } from './helpers'

/**
 * СТОРОЖ «НЕТ КОДОВ И АНГЛИЙСКОГО» В CONTROL (партия 62-F).
 *
 * Обходит все экраны консоли на русском, 1440: семь разделов меню, девять
 * вкладок карточки отеля, шесть вкладок группы, страницу модуля — и читает
 * ВИДИМЫЙ текст. Ищет коды (`a_b`, `a.b.c`), ключи переводов и английские
 * слова. Подсказки по наведению (код действия в журнале) не видны и не
 * считаются — так и задумано.
 *
 * ДАННЫЕ — не интерфейс: названия отелей, групп, людей, почты и поддомены
 * вычитаются до проверки (их пишет человек, а не экран). Всё, что можно
 * писать латиницей в самом интерфейсе, — в ALLOWED, одном месте.
 *
 * Находки складываются в `test-results/words-guard.json` — по экрану.
 */

/** Латиница, которой интерфейсу можно: имена продуктов и общепринятые сокращения. */
const ALLOWED = ['NaviRoom Control', 'NaviRoom', 'Control', 'iRidi', 'PIN', 'QR', 'Telegram', 'GRMS', 'DNS', 'CNAME', 'запись A', 'CSV', 'JSON', 'Excel', 'Wi-Fi', 'TOTP', '2FA', 'UTC', 'API']

const CODE_SNAKE = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g
const CODE_DOTTED = /\b[a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+\b/g
const I18N_KEY = /\b(admin|state|common|nav|errors|dashboard)\.[a-zA-Z][\w.]*/g
const LATIN_WORD = /\b[A-Za-z][A-Za-z'-]*[A-Za-z]\b|\b[A-Za-z]\b/g

interface Screen {
  name: string
  url: string
  ready: string
}

async function platformHeaders(request: APIRequestContext) {
  const access = (await (await request.post(`${API}/api/v1/platform/auth/login`, { data: PLATFORM })).json()).access
  return { Authorization: `Bearer ${access}` }
}

/** Всё, что пишет человек: убрать из текста до проверки. */
async function dataWords(request: APIRequestContext, headers: Record<string, string>): Promise<string[]> {
  const out: string[] = []
  const fleet = await (await request.get(`${API}/api/v1/platform/fleet?layout=list&origin=all&page_size=500`, { headers })).json()
  for (const row of fleet.items ?? []) {
    out.push(row.name, row.subdomain)
    if (row.group?.title) out.push(row.group.title)
    if (typeof row.city === 'string') out.push(row.city)
  }
  const groups = await (await request.get(`${API}/api/v1/platform/groups`, { headers })).json()
  for (const g of groups.items ?? []) out.push(g.title, g.code, g.description ?? '', g.note ?? '')
  const team = await (await request.get(`${API}/api/v1/platform/team?limit=200`, { headers })).json()
  for (const m of team.items ?? []) out.push(m.full_name ?? '', m.email ?? '')
  // Журнал действий называет и удалённые отели — их нет в списке отелей.
  const audit = await (await request.get(`${API}/api/v1/platform/audit?limit=200`, { headers })).json()
  for (const row of audit.items ?? []) out.push(row.hotel ?? '', row.subdomain ?? '')
  // Узлы: имя и версию пишет тот, кто ставит коннектор.
  const nodes = await (await request.get(`${API}/api/v1/platform/nodes?limit=200`, { headers })).json()
  for (const n of nodes.items ?? []) out.push(n.name ?? '', n.version ?? '')
  return out.filter((w) => w && w.length > 1).sort((a, b) => b.length - a.length)
}

function findings(text: string, data: string[]): string[] {
  return text
    .split('\n')
    .flatMap((line) => lineFindings(line, data).map((word) => `${word} ⟵ «${line.trim().slice(0, 90)}»`))
}

function lineFindings(text: string, data: string[]): string[] {
  // Почты и имена ботов — первыми: иначе вычет поддомена разрежет почту.
  let t = text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ').replace(/@\w+/g, ' ')
  for (const w of data) t = t.split(w).join(' ')
  t = t
    .replace(/\bhttps?:\/\/\S+/g, ' ') // адреса
    .replace(/\b[\w-]+(\.[\w-]+)*\.(sslip\.io|navicentric\.ru|localhost|local|test)\b/g, ' ') // поддомены и домены стендов
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, ' ')
  for (const w of ALLOWED) t = t.split(w).join(' ')
  const out = new Set<string>()
  for (const re of [I18N_KEY, CODE_DOTTED, CODE_SNAKE]) for (const m of t.match(re) ?? []) out.add(m)
  for (const m of t.match(LATIN_WORD) ?? []) out.add(m)
  return [...out]
}

/**
 * Видимый текст без данных: элементы с `data-words="data"` (строка браузера,
 * идентификаторы оборудования, монограмма почты) и украшения `aria-hidden`
 * (буквы знака NaviRoom Control) временно прячутся.
 */
async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const hidden = [...document.querySelectorAll<HTMLElement>('[data-words="data"], [aria-hidden="true"]')]
    const before = hidden.map((el) => el.style.visibility)
    hidden.forEach((el) => (el.style.visibility = 'hidden'))
    const text = document.body.innerText
    hidden.forEach((el, i) => (el.style.visibility = before[i]))
    return text
  })
}

test.describe.configure({ mode: 'serial' })

test('Control: на экранах нет кодов, ключей и английских слов', async ({ page, request }) => {
  test.setTimeout(10 * 60_000)
  const headers = await platformHeaders(request)
  const fleet = await (await request.get(`${API}/api/v1/platform/fleet?search=crystal&origin=all`, { headers })).json()
  const crystal = (fleet.items as { id: string; subdomain: string }[]).find((r) => r.subdomain === 'crystal')!.id

  // Группа для обхода её вкладок — своя, пустая, и уходит после.
  const title = `Сторож слов ${Date.now()}`
  const created = await (await request.post(`${API}/api/v1/platform/groups`, { data: { title, hotel_ids: [] }, headers })).json()
  const data = await dataWords(request, headers)

  const screens: Screen[] = [
    ...['overview', 'fleet', 'modules', 'templates', 'team', 'audit', 'security'].map((s) => ({ name: `раздел ${s}`, url: `/admin?section=${s}`, ready: 'admin-shell' })),
    { name: 'справочники: справочник', url: '/admin?section=templates&tab=dictionary', ready: 'admin-shell' },
    { name: 'журнал: входы поддержки', url: '/admin?section=audit&view=support', ready: 'admin-shell' },
    ...['overview', 'profile', 'modules', 'connections', 'rooms', 'roomControl', 'journal', 'history', 'data'].map((tab) => ({
      name: `отель: ${tab}`,
      url: `/admin?section=fleet&hotel=${crystal}&tab=${tab}`,
      ready: 'admin-hotel',
    })),
    ...['summary', 'hotels', 'profile', 'actions', 'defaults', 'history'].map((tab) => ({
      name: `группа: ${tab}`,
      url: `/admin?section=fleet&gpage=${created.id}&gtab=${tab}`,
      ready: 'admin-shell',
    })),
    { name: 'модуль: room_control', url: '/admin?section=modules&module=room_control', ready: 'admin-module-page' },
    { name: 'модуль: pms', url: '/admin?section=modules&module=pms', ready: 'admin-module-page' },
  ]

  const report: Record<string, string[]> = {}
  try {
    await page.addInitScript(() => window.localStorage.setItem('itv.lang', 'ru'))
    await signInPlatform(page, PLATFORM)
    for (const screen of screens) {
      await page.goto(screen.url)
      await expect(page.getByTestId(screen.ready)).toBeVisible({ timeout: 30_000 })
      await page.waitForLoadState('networkidle').catch(() => undefined)
      await expect(page.getByTestId('state-loading')).toHaveCount(0, { timeout: 20_000 })
      await page.waitForTimeout(800)
      const found = findings(await visibleText(page), data)
      if (found.length) report[screen.name] = found
    }
  } finally {
    await request.delete(`${API}/api/v1/platform/groups/${created.id}?confirm_title=${encodeURIComponent(title)}`, { headers })
  }

  mkdirSync('test-results', { recursive: true })
  writeFileSync('test-results/words-guard.json', JSON.stringify(report, null, 2))
  const lines = Object.entries(report).map(([name, found]) => `${name}: ${found.join(', ')}`)
  expect(lines, `коды и английский на экранах Control:\n${lines.join('\n')}`).toEqual([])
})
