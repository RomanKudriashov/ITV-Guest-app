import { snapshotStand } from './fixtures/stand'
import { assertTelegramEmulator } from './fixtures/telegramGuard'

/**
 * Снимок стенда до прогона. Всё, чего здесь нет, а после прогона есть, —
 * создано тестами и будет убрано в global-teardown.
 */
export default async function globalSetup(): Promise<void> {
  // Первым: прогон поверх живого бота не должен начаться вовсе.
  await assertTelegramEmulator()
  await snapshotStand()
}
