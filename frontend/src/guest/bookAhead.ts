/**
 * МОЖНО ЛИ ОФОРМИТЬ НА БУДУЩЕЕ, КОГДА «СЕЙЧАС» ЗАКРЫТО (партия 29, п.60).
 *
 * Доступность решает время, на которое заказ: слот — время слота, заявка со
 * сроком — срок гостя. Позиция, недоступная сейчас только по часам (заведение
 * или раздел закрыты), на будущее время доступна — проверит сервер на то самое
 * время. Стоп-лист, выключенная позиция — не про часы: их будущее не лечит.
 */
const HOURS_ONLY = new Set(['venue_closed', 'schedule']);

export function closedOnlyByHours(item: { is_available: boolean; unavailable_reason?: string | null }): boolean {
  return !item.is_available && HOURS_ONLY.has(item.unavailable_reason ?? '');
}
