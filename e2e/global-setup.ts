import { snapshotStand } from './fixtures/stand'

/**
 * Снимок стенда до прогона. Всё, чего здесь нет, а после прогона есть, —
 * создано тестами и будет убрано в global-teardown.
 */
export default async function globalSetup(): Promise<void> {
  await snapshotStand()
}
