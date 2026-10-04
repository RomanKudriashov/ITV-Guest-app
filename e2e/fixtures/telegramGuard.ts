/**
 * СТОРОЖ ПРОГОНА: СЛУЖБЫ СМОТРЯТ В ЭМУЛЯТОР BOT API, А НЕ В TELEGRAM (партия 30).
 *
 * Локальный `.env` может направлять стек на живого бота — его включают для
 * ручной проверки. Прогон поверх такого стека слал бы уведомления живым людям,
 * а `telegram-bot.spec.ts` падал бы на имени бота, похоже на дефект. Поэтому
 * до первого теста спрашиваем у backend, worker и bot их `TELEGRAM_API_URL`;
 * смотрит хоть один в *.telegram.org — прогон не стартует.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const SERVICES = ['backend', 'worker', 'bot'] as const

const HOW_TO_FIX = [
  'Поднимите службы с эмулятором Bot API, не трогая .env:',
  '  TELEGRAM_API_URL=http://telegram-emulator:1087 TELEGRAM_BOT_TOKEN=emulator-token \\',
  '    docker compose --profile grms up -d backend worker bot',
  'После прогона вернуть живого бота: docker compose --profile grms up -d backend worker bot',
].join('\n')

export function pointsToRealTelegram(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'telegram.org' || host.endsWith('.telegram.org')
  } catch {
    return false
  }
}

export async function assertTelegramEmulator(): Promise<void> {
  const run = promisify(execFile)
  const real: string[] = []
  for (const service of SERVICES) {
    let url = ''
    try {
      const { stdout } = await run('docker', ['compose', 'exec', '-T', service, 'printenv', 'TELEGRAM_API_URL'], {
        cwd: process.cwd() + '/..',
        timeout: 30_000,
      })
      url = stdout.trim()
    } catch {
      // Служба не поднята — в Telegram она не пишет. Проверять нечего.
      continue
    }
    if (pointsToRealTelegram(url)) real.push(`${service} → ${url}`)
  }
  if (real.length) {
    throw new Error(
      `ПРОГОН ОСТАНОВЛЕН: службы смотрят в настоящий Telegram:\n  ${real.join('\n  ')}\n` +
        'Тесты отправили бы сообщения живым людям.\n' +
        HOW_TO_FIX,
    )
  }
}
