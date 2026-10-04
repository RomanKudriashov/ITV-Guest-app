/**
 * Причины отмены — коды `Order.CancelReason` сервера (партия 31, DEV-01).
 *
 * Сервер требует КОД (`cancel_reason`), уточнение словами — по желанию
 * (`reason`). Список — близнец серверного справочника; расхождение ловит
 * `scripts/check-registries.mjs`. Подписи — в локалях `tracker.cancel.reasons`.
 */
export const CANCEL_REASONS = [
  'out_of_stock',
  'guest_refused',
  'no_capacity',
  'duplicate',
  'mistake',
  'other',
] as const;

export type CancelReasonCode = (typeof CANCEL_REASONS)[number];
