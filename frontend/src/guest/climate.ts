/**
 * ЧТО ФАНКОЙЛ ДЕЛАЕТ НА САМОМ ДЕЛЕ (партия 65).
 *
 * Режим — это не действие. Охлаждение с уставкой 30° при 23° в номере ничего
 * не охлаждает: контроллер (у Сиалии — Bittel) откроет клапан холода, только
 * когда в номере станет теплее уставки. Нагрев с уставкой 18° при 23° — так же.
 * Клапаны ведёт контроллер; экран лишь честно показывает, что из этого
 * следует, — и поток на плане, и подпись под режимом берут ответ отсюда.
 *
 * Порог — 0,5°: точнее датчик не меряет, а у контроллера свой гистерезис.
 * «Авто» — когда его отдаёт оборудование: контроллер сам выбирает нагрев или
 * охлаждение и держит уставку; зона нечувствительности — ±1°.
 */
export type ClimateMode = 'cool' | 'heat' | 'fan' | 'auto' | 'dry';

export type ClimateAction =
  /** Холодит: в номере теплее уставки. */
  | 'cooling'
  /** Греет: в номере холоднее уставки. */
  | 'heating'
  /** Режим охлаждения, но холодить незачем — в номере уже не теплее уставки. */
  | 'idle-cool'
  /** Режим нагрева, но греть незачем — в номере уже не холоднее уставки. */
  | 'idle-heat'
  /** Авто: температура в зоне уставки, ни нагрева, ни охлаждения. */
  | 'holding'
  /** Только вентиляция, клапаны закрыты. */
  | 'fan'
  /** Режима нет (у отеля нет такого канала) или он не прочитан. */
  | 'unknown';

export const HYSTERESIS = 0.5;
export const AUTO_DEADBAND = 1;

export function climateAction(
  mode: ClimateMode | null | undefined,
  setpoint: number | null | undefined,
  current: number | null | undefined,
): ClimateAction {
  if (mode === 'fan' || mode === 'dry') return 'fan';
  if (mode !== 'cool' && mode !== 'heat' && mode !== 'auto') return 'unknown';
  // Без двух чисел сравнивать нечего — показываем режим как есть.
  if (setpoint == null || current == null) return mode === 'cool' ? 'cooling' : mode === 'heat' ? 'heating' : 'holding';
  if (mode === 'cool') return current > setpoint + HYSTERESIS ? 'cooling' : 'idle-cool';
  if (mode === 'heat') return current < setpoint - HYSTERESIS ? 'heating' : 'idle-heat';
  if (current > setpoint + AUTO_DEADBAND) return 'cooling';
  if (current < setpoint - AUTO_DEADBAND) return 'heating';
  return 'holding';
}

/**
 * Насколько сильно работает: 0…1 по разнице с уставкой, 5° и больше — 1.
 * Без текущей температуры — середина: режим читается, сила неизвестна.
 */
export function climateEffort(setpoint: number | null | undefined, current: number | null | undefined): number {
  if (setpoint == null || current == null) return 0.5;
  return Math.max(0, Math.min(1, Math.abs(current - setpoint) / 5));
}
