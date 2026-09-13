import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { expect, test, type APIRequestContext } from '@playwright/test'

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

function familyOf(type: string): Family {
  const clean = type.trim()
  if (/^ListPage</.test(clean) || /^Page</.test(clean)) return 'page'
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
  const seen = new Set<string>()

  for (const call of declared) {
    if (seen.has(call.path)) continue
    seen.add(call.path)

    const response = await request.get(`${API}/api${call.path}`, { headers })
    if (!response.ok()) {
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
  expect(unreachable, `Ручки, которых фронт зовёт, а сервер не отдаёт:\n${unreachable.join('\n')}`)
    .toEqual([])
  expect(mismatches, `Расхождения формы ответа:\n${mismatches.join('\n')}`).toEqual([])
})
