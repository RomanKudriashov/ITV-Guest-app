import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

import { ADMIN, API, HOTEL } from './helpers'

/**
 * СВЕРКА КОНТРАКТОВ: что объявил фронт против того, что шлёт сервер.
 *
 * Класс поломок, ради которого она написана, стоил этому проекту трёх экранов
 * сразу, и ни один тест его не видел:
 *
 *   • журнал уведомлений объявлен массивом, сервер шлёт конверт `{items,…}` —
 *     вкладка падала с `TypeError: entries is not iterable` при открытии;
 *   • список сотрудников — то же самое, только тихо: `Array.isArray` на
 *     конверте даёт `[]`, и поле «Сотрудник» блокировалось с подписью
 *     «сотрудников нет»;
 *   • расписания — наоборот: сервер шлёт голый список, а клиент разворачивал
 *     `.items` и получал `undefined`.
 *
 * Ни один из трёх не ловится ни типами (TypeScript верит объявлению), ни
 * тестом экрана, которого нет. Ловится только СВЕРКОЙ С ЖИВЫМ ОТВЕТОМ.
 *
 * Сверяется СЕМЕЙСТВО ФОРМЫ — список / конверт / объект — и с партии 22
 * ОБЯЗАТЕЛЬНЫЕ ПОЛЯ. Поля нужны потому, что семейство совпало у «Операций»
 * аналитики, а вкладка рисовала «NaN»: читала `rows`, `avg_*` и
 * `escalations` числом, которых сервер не слал никогда. Сторож её не видел
 * дважды: путь собран шаблоном (`${BASE}/operations`), а регулярка брала
 * только строки в кавычках; и сверялась одна форма.
 *
 * Теперь:
 *   • шаблонный путь разрешается, если в нём только константы модуля
 *     (`BASE`) и строка запроса; путь с идентификатором сверить нечем — он
 *     печатается списком, а не пропускается молча;
 *   • поле, объявленное в интерфейсе ответа БЕЗ `?`, обязано быть в живом
 *     ответе (у страницы и списка — в первом элементе). Необязательные (`?`)
 *     не сверяются: они приходят по состоянию данных.
 */

const ROOT = join(__dirname, '..', '..', 'frontend', 'src')

type Family = 'array' | 'page' | 'object'

interface Declared {
  file: string
  path: string
  family: Family
  type: string
}

function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sources(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** `api.get<Type>('/path')` и `.get<Type>('/path')`, включая многострочные. */
const CALL = /\.get<([^>]*(?:<[^>]*>)?[^>]*)>\(\s*'([^'`$]+)'/g

/** То же с шаблоном: `.get<Type>(`${BASE}/operations`)`. */
const TEMPLATE_CALL = /\.get<([^>]*(?:<[^>]*>)?[^>]*)>\(\s*`([^`]+)`/g

/** Строковые константы модуля: `const BASE = '/cms/analytics'`. */
function moduleConstants(text: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of text.matchAll(/^(?:export\s+)?const\s+([A-Za-z_]\w*)\s*=\s*'([^']*)';?\s*$/gm)) {
    found.set(match[1], match[2])
  }
  return found
}

/**
 * Путь из шаблона — или `null`, если в пути есть то, чего до запуска не знать
 * (идентификатор). Строка запроса отрезается: фильтры у ручек необязательны.
 */
function resolveTemplate(template: string, constants: Map<string, string>): string | null {
  const path = template.split('?')[0]
  let unresolved = false
  const resolved = path.replace(/\$\{\s*([A-Za-z_]\w*)\s*\}/g, (_, name: string) => {
    const value = constants.get(name)
    if (value === undefined) unresolved = true
    return value ?? ''
  })
  return unresolved || resolved.includes('${') ? null : resolved
}

/*
  ИНТЕРФЕЙСЫ ОТВЕТОВ: имя → обязательные поля верхнего уровня (с учётом
  `extends`). Разбор построчный: поле — строка на глубине 1 вида `name: …`
  без `?`. Одно имя в двух файлах с разными полями — неоднозначно, такой тип
  сторож не сверяет и говорит об этом.
*/
interface ParsedInterface {
  file: string
  required: string[]
  parents: string[]
  /** `items: X[]` — конверт выдачи, объявленный полями, а не через ListPage. */
  itemsOf: string | null
  /** `extends ListPage<X>` — конверт с дополнительными полями. */
  pageOf: string | null
}

function parseInterfaces(): Map<string, ParsedInterface[]> {
  const found = new Map<string, ParsedInterface[]>()
  for (const file of sources(ROOT)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (let index = 0; index < lines.length; index++) {
      const head = lines[index].match(
        /^export\s+interface\s+([A-Za-z_]\w*)(?:<[^>]*>)?(?:\s+extends\s+([^{]+))?\s*\{\s*$/,
      )
      if (!head) continue
      const pageOf = (head[2] ?? '').match(/(?:ListPage|Page)<\s*([A-Za-z_]\w*)\s*>/)?.[1] ?? null
      const parents = (head[2] ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => /^[A-Za-z_]\w*$/.test(name))
      const required: string[] = []
      let itemsOf: string | null = null
      let depth = 1
      let inComment = false
      for (index++; index < lines.length && depth > 0; index++) {
        const line = lines[index]
        const trimmed = line.trim()
        if (inComment) {
          if (trimmed.includes('*/')) inComment = false
          continue
        }
        if (trimmed.startsWith('/*')) {
          if (!trimmed.includes('*/')) inComment = true
          continue
        }
        if (depth === 1 && !trimmed.startsWith('//')) {
          const field = trimmed.match(/^(?:readonly\s+)?([A-Za-z_]\w*)(\?)?\s*:/)
          if (field && !field[2]) required.push(field[1])
          const items = trimmed.match(/^items\s*:\s*([A-Za-z_]\w*)\[\]\s*;?$/)
          if (items) itemsOf = items[1]
        }
        for (const char of line.replace(/\/\/.*$/, '')) {
          if (char === '{') depth++
          else if (char === '}') depth--
        }
      }
      index--
      const entry = { file: relative(ROOT, file), required, parents, itemsOf, pageOf }
      found.set(head[1], [...(found.get(head[1]) ?? []), entry])
    }
  }
  return found
}

const INTERFACES = parseInterfaces()

/** Обязательные поля типа — или `null`, если тип неизвестен или неоднозначен. */
function requiredFields(name: string, seen = new Set<string>()): string[] | null {
  const entries = INTERFACES.get(name)
  if (!entries?.length) return null
  const shapes = new Set(entries.map((entry) => entry.required.join(',')))
  if (shapes.size > 1) return null
  if (seen.has(name)) return []
  seen.add(name)
  const fields = new Set(entries[0].required)
  for (const parent of entries[0].parents) {
    for (const field of requiredFields(parent, seen) ?? []) fields.add(field)
  }
  return [...fields]
}

/**
 * Кто несёт поля: `envelope` — тип самого ответа (у страницы — её собственные
 * поля сверх `items`), `item` — тип элемента списка или страницы.
 * `X[]` → элемент X; `ListPage<X>` → элемент X; `interface P extends
 * ListPage<X>` / `interface P { items: X[] }` → конверт P и элемент X.
 */
function carriers(type: string): { envelope: string | null; item: string | null } {
  const clean = type.replace(/\|\s*null/g, '').trim()
  const generic = clean.match(/^(?:ListPage|Page)<\s*([A-Za-z_]\w*)\s*>$/)
  if (generic) return { envelope: null, item: generic[1] }
  if (clean.endsWith('[]')) return { envelope: null, item: clean.slice(0, -2) }
  const declared = INTERFACES.get(clean)?.[0]
  const item = declared?.itemsOf ?? declared?.pageOf ?? null
  return { envelope: clean, item }
}

/*
  ИЗВЕСТНЫЕ РАСХОЖДЕНИЯ ПОЛЕЙ — найдены сторожем при включении (партия 22),
  не чинены по решению тек-лида и записаны в бэклог (`stand-defects.md`,
  пункт 47). Список ЗАКРЫТЫЙ: новое расхождение краснеет, а починенное
  здесь — тоже (строку надо убрать, иначе список врёт).
*/
const KNOWN_FIELD_GAPS = new Set<string>([])

/**
 * Имена типов, объявленных как страница: `interface X extends ListPage<…>`.
 *
 * Без этого сторож считал страницей только буквальное `api.get<ListPage<T>>`.
 * Выдача с дополнительным полем (например `kind_applies` у справочников)
 * объявляется своим именем — и честная страница читалась как простой объект,
 * то есть сторож ругался на совпадающие стороны.
 */
function pageAliases(): Set<string> {
  const names = new Set<string>()
  for (const file of sources(ROOT)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/interface\s+([A-Za-z0-9_]+)\s+extends\s+(?:ListPage|Page)</g)) {
      names.add(match[1])
    }
  }
  return names
}

const PAGE_ALIASES = pageAliases()

function familyOf(type: string): Family {
  const clean = type.trim()
  if (/^ListPage</.test(clean) || /^Page</.test(clean)) return 'page'
  if (PAGE_ALIASES.has(clean)) return 'page'
  // Конверт, объявленный полями (`items: X[]`), — страница, как и ListPage<X>.
  if (INTERFACES.get(clean)?.some((entry) => entry.itemsOf)) return 'page'
  if (/\[\]$/.test(clean)) return 'array'
  return 'object'
}

/** Шаблонные вызовы CMS, путь которых до запуска не узнать, — печатаются. */
const WITH_PARAMETERS: string[] = []

function declaredCalls(): Declared[] {
  const found: Declared[] = []
  for (const file of sources(ROOT)) {
    const text = readFileSync(file, 'utf-8')
    const where = relative(ROOT, file)
    for (const match of text.matchAll(CALL)) {
      const [, type, path] = match
      // Только ручки CMS: гостевые и трекерные живут своими контрактами и
      // конверт листинга не используют вовсе.
      if (!path.startsWith('/cms/')) continue
      found.push({ file: where, path, family: familyOf(type), type: type.trim() })
    }
    const constants = moduleConstants(text)
    for (const match of text.matchAll(TEMPLATE_CALL)) {
      const [, type, template] = match
      const path = resolveTemplate(template, constants)
      if (path === null) {
        if (template.includes('/cms/') || /^\$\{\s*[A-Z_]+\s*\}/.test(template)) {
          WITH_PARAMETERS.push(`${template} (${where})`)
        }
        continue
      }
      if (!path.startsWith('/cms/')) continue
      found.push({ file: where, path, family: familyOf(type), type: type.trim() })
    }
  }
  return found
}

function serverFamily(body: unknown): Family {
  if (Array.isArray(body)) return 'array'
  if (body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)) {
    return 'page'
  }
  return 'object'
}

async function token(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API}/api/staff/auth/login`, {
    data: ADMIN,
    headers: { 'X-Hotel-Subdomain': HOTEL },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).access
}

test('форма ответа каждой ручки CMS совпадает с объявленной на фронте', async ({ request }) => {
  const declared = declaredCalls()
  expect(declared.length, 'не найдено ни одного вызова CMS — сверять нечего').toBeGreaterThan(10)

  const headers = {
    Authorization: `Bearer ${await token(request)}`,
    'X-Hotel-Subdomain': HOTEL,
  }

  const mismatches: string[] = []
  const unreachable: string[] = []
  const gated: string[] = []
  const unchecked: string[] = []
  const fieldGaps: string[] = []
  const knownSeen = new Set<string>()
  const seen = new Set<string>()

  for (const call of declared) {
    if (seen.has(call.path)) continue
    seen.add(call.path)

    const response = await request.get(`${API}/api${call.path}`, { headers })
    if (!response.ok()) {
      /*
        403 «модуль выключен» — НЕ расхождение контракта, а законный гейт.

        Раздел за модулем закрыт на сервере намеренно: спрятать пункт меню в
        бандле значит не закрыть ничего. Фронт такой адрес зовёт, и это
        правильно — на экране он показывает отказ, а не вечный скелет. Форму
        ответа такой ручки сторож проверить не может и честно об этом говорит
        строкой ниже, вместо того чтобы краснеть на исправном устройстве.
      */
      const body = (await response.json().catch(() => ({}))) as { code?: string }
      if (response.status() === 403 && body.code === 'module_disabled') {
        gated.push(`${call.path} (${call.file})`)
        continue
      }
      unreachable.push(`${call.path} → ${response.status()} (${call.file})`)
      continue
    }
    const body = await response.json()
    const actual = serverFamily(body)
    if (actual !== call.family) {
      mismatches.push(
        `${call.path}: фронт объявил ${call.family} (\`${call.type}\`, ${call.file}), ` +
          `сервер шлёт ${actual}`,
      )
      continue
    }

    // Поля — у того, кто их несёт: конверт сверяется с ответом (без `items`),
    // элемент — с первым элементом списка или страницы.
    const { envelope, item } = carriers(call.type)
    const targets: Array<[string, unknown, string[]]> = []
    for (const [name, sample] of [
      [envelope, body],
      [item, actual === 'array' ? body[0] : actual === 'page' ? body.items[0] : null],
    ] as Array<[string | null, unknown]>) {
      if (!name) continue
      const required = requiredFields(name)
      if (required === null) {
        unchecked.push(`${call.path}: \`${name}\` не найден или объявлен по-разному`)
        continue
      }
      // Пустой список — полей элемента не показать; это не расхождение.
      if (sample && typeof sample === 'object') {
        targets.push([name, sample, required.filter((field) => field !== 'items')])
      }
    }
    for (const [name, sample, required] of targets) {
      for (const field of required) {
        if (field in (sample as object)) continue
        const gap = `${call.path} ${name}.${field}`
        if (KNOWN_FIELD_GAPS.has(gap)) {
          knownSeen.add(gap)
          continue
        }
        fieldGaps.push(`${gap} — фронт читает (${call.file}), сервер не шлёт`)
      }
    }
  }

  /*
    Недоступная ручка — тоже расхождение, а не «пропустим».
    Фронт зовёт адрес, которого нет или который отвечает отказом; на экране это
    вечный скелет или пустой список.
  */
  // Пропущенные печатаем: «сторож молча пропустил» — это как раз то, из-за
  // чего дыры живут годами.
  if (gated.length) {
    console.log(`Не сверены — раздел выключен модулем:\n${gated.join('\n')}`)
  }
  expect(unreachable, `Ручки, которых фронт зовёт, а сервер не отдаёт:\n${unreachable.join('\n')}`)
    .toEqual([])
  expect(mismatches, `Расхождения формы ответа:\n${mismatches.join('\n')}`).toEqual([])

  if (WITH_PARAMETERS.length) {
    console.log(`Не сверены — в пути идентификатор:\n${[...new Set(WITH_PARAMETERS)].join('\n')}`)
  }
  if (unchecked.length) console.log(`Поля не сверены:\n${unchecked.join('\n')}`)
  expect(fieldGaps, `Фронт читает поля, которых сервер не шлёт:\n${fieldGaps.join('\n')}`).toEqual([])
  // Закрытый список: починили — уберите строку, иначе он врёт.
  const stale = [...KNOWN_FIELD_GAPS].filter((gap) => !knownSeen.has(gap))
  expect(stale, `Известные расхождения больше не воспроизводятся:\n${stale.join('\n')}`).toEqual([])
})
