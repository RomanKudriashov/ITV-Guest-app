import { healBrandBeforeRun, snapshotStand } from './fixtures/stand'
import { dropLeftoverE2EHotels, seedE2EHotel } from './fixtures/e2eHotel'
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
  await healBrandBeforeRun()
  // Отель прогона: оставшийся от прерванного — убрать ДО снимка, свой завести
  // ПОСЛЕ — тогда его уберёт штатная уборка в конце, как любой созданный прогоном.
  const dropped = await dropLeftoverE2EHotels()
  if (dropped) console.warn(`[стенд] убрано отелей прошлых прогонов e2e-…: ${dropped}`)
  await snapshotStand()
  await seedE2EHotel()
}
