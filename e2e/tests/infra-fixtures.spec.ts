import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from './fixtures'

/**
 * СТОРОЖ ОСНОВЫ: каждая проверка берёт `test` и `expect` из `./fixtures`.
 *
 * Основа выходит из всех сессий, открытых прогоном. Проверка, взявшая `test`
 * прямо из `@playwright/test`, выходить перестанет — и входы снова начнут
 * копиться неделями (пункт 32 бэклога).
 */
test('проверки берут test и expect из общей основы', () => {
  const dir = __dirname
  const offenders = readdirSync(dir)
    .filter((name) => name.endsWith('.spec.ts'))
    .filter((name) => {
      const text = readFileSync(join(dir, name), 'utf8')
      const direct = /import\s*\{([^}]*)\}\s*from\s*'@playwright\/test'/.exec(text)
      if (!direct) return false
      return direct[1]
        .split(',')
        .map((entry) => entry.trim())
        .some((entry) => entry === 'test' || entry === 'expect')
    })
  expect(offenders, 'импортируйте test и expect из ./fixtures').toEqual([])
})
