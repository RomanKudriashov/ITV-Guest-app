import { snapshotStand } from './fixtures/stand'
import { assertTelegramEmulator } from './fixtures/telegramGuard'
import { exportRequestBodies } from './fixtures/requestBodies'

/**
 * Снимок стенда до прогона. Всё, чего здесь нет, а после прогона есть, —
 * создано тестами и будет убрано в global-teardown.
 */
export default async function globalSetup(): Promise<void> {
  // Первым: прогон поверх живого бота не должен начаться вовсе.
  await assertTelegramEmulator()
  // Карта тел запросов — для сторожа контракта в tests/fixtures.ts.
  await exportRequestBodies()
  await snapshotStand()
}
