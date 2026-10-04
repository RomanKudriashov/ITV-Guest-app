/**
 * СТОРОЖ ТЕЛ ЗАПРОСОВ: ФРОНТ ШЛЁТ ТО, ЧТО ЖДЁТ РУЧКА (партия 31, DEV-01).
 *
 * Проверки ответов не видят, ЧТО фронт положил в тело: django-ninja молча
 * отбрасывает лишние поля, а пропущенное обязательное всплывает 422 только у
 * человека. Так трекер слал `{"reason": …}` при обязательном `cancel_reason`.
 *
 * Карта «метод + адрес → поля, обязательные» выгружается из OpenAPI бэкенда в
 * globalSetup (`manage.py export_request_bodies`). Каждое JSON-тело, которое
 * отправляет СТРАНИЦА (фронт), сверяется с ней; прямые вызовы API из самих
 * проверок не сверяются — это не код продукта.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

interface BodySpec {
  json: boolean
  fields?: string[]
  required?: string[]
  open?: boolean
}

const FILE = join(__dirname, '..', '.request-bodies.json')

export async function exportRequestBodies(): Promise<void> {
  const run = promisify(execFile)
  const { stdout } = await run(
    'docker',
    ['compose', 'exec', '-T', 'backend', 'python', 'manage.py', 'export_request_bodies'],
    { cwd: join(__dirname, '..', '..'), timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
  )
  JSON.parse(stdout)
  writeFileSync(FILE, stdout)
}

let compiled: Array<{ method: string; pattern: RegExp; template: string; spec: BodySpec }> | null = null

function load() {
  if (compiled) return compiled
  if (!existsSync(FILE)) throw new Error(`Нет карты тел запросов ${FILE}: её кладёт globalSetup`)
  const map = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, BodySpec>
  compiled = Object.entries(map).map(([key, spec]) => {
    const [method, template] = key.split(' ')
    const source = template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '[^/]+')
    return { method, template, spec, pattern: new RegExp(`^${source.replace(/\{[^}]+\}/g, '[^/]+')}/?$`) }
  })
  return compiled
}

/** `/api/cms/x` и `/api/v1/cms/x` — один адрес: короткая форма — псевдоним v1. */
function normalize(url: string): string | null {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return null
  }
  if (!path.startsWith('/api/')) return null
  return path.startsWith('/api/v1/') ? path : `/api/v1/${path.slice('/api/'.length)}`
}

/** Нарушения одного тела — пустой список, если всё сходится или сверять нечего. */
export function checkBody(method: string, url: string, raw: string | null): string[] {
  if (!['POST', 'PUT', 'PATCH'].includes(method) || !raw) return []
  const path = normalize(url)
  if (!path) return []
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return []
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return []
  const entry = load().find((item) => item.method === method && item.pattern.test(path))
  if (!entry) return [`${method} ${path}: такой ручки в API нет`]
  const { spec } = entry
  if (!spec.json || spec.open) return []
  const keys = Object.keys(body as Record<string, unknown>)
  const problems: string[] = []
  const unknown = keys.filter((key) => !(spec.fields ?? []).includes(key))
  const missing = (spec.required ?? []).filter((key) => !keys.includes(key))
  if (unknown.length) problems.push(`${method} ${entry.template}: поля, которых схема не знает: ${unknown.join(', ')}`)
  if (missing.length) problems.push(`${method} ${entry.template}: не прислано обязательное: ${missing.join(', ')}`)
  return problems
}
