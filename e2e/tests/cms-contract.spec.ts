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
 * Сверяется СЕМЕЙСТВО ФОРМЫ — список / конверт / объект, — а не поля: поля
 * необязательны и приходят по состоянию данных, а форма обязана совпадать
 * всегда. Именно на семействе и разъезжались все три.
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
  if (/\[\]$/.test(clean)) return 'array'
  return 'object'
}

function declaredCalls(): Declared[] {
  const found: Declared[] = []
  for (const file of sources(ROOT)) {
    const text = readFileSync(file, 'utf-8')
    for (const match of text.matchAll(CALL)) {
      const [, type, path] = match
      // Только ручки CMS: гостевые и трекерные живут своими контрактами и
      // конверт листинга не используют вовсе.
      if (!path.startsWith('/cms/')) continue
      found.push({ file: relative(ROOT, file), path, family: familyOf(type), type: type.trim() })
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
    const actual = serverFamily(await response.json())
    if (actual !== call.family) {
      mismatches.push(
        `${call.path}: фронт объявил ${call.family} (\`${call.type}\`, ${call.file}), ` +
          `сервер шлёт ${actual}`,
      )
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
})
