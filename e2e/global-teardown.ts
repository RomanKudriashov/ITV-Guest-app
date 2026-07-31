import { cleanupStand } from './fixtures/stand'

/**
 * Уборка стенда. Отрабатывает при любом исходе прогона — в том числе когда
 * тесты падали: собственный `finally` теста при таймауте не выполняется.
 */
export default async function globalTeardown(): Promise<void> {
  await cleanupStand()
}
