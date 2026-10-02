import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * ПАРОЛЬ ВЛАДЕЛЬЦА ПЛАТФОРМЫ — ИЗ ФАЙЛА ВНЕ РЕПОЗИТОРИЯ (партия 27).
 *
 * Пароль стенда в документах держать нельзя: однажды он попал в вывод
 * терминала из документа на сервере и был сменён. Теперь он лежит в файле на
 * машине разработчика (`~/.config/itv-stand/platform-password`, права 600);
 * смок и обходные скрипты читают его оттуда.
 *
 * Порядок: переменная окружения (если задана явно) → файл
 * (`E2E_PLATFORM_PASSWORD_FILE` или путь по умолчанию) → пусто.
 */
export const PLATFORM_PASSWORD_FILE =
  process.env.E2E_PLATFORM_PASSWORD_FILE ?? join(homedir(), '.config', 'itv-stand', 'platform-password')

export function platformPassword(envName = 'E2E_PLATFORM_PASSWORD') {
  const fromEnv = process.env[envName]
  if (fromEnv) return fromEnv
  if (existsSync(PLATFORM_PASSWORD_FILE)) return readFileSync(PLATFORM_PASSWORD_FILE, 'utf8').trim()
  return ''
}
