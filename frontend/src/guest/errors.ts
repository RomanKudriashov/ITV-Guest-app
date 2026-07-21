import type { TFunction } from 'i18next';

import { ApiError } from '@/api/client';
import { NetworkError } from './api/client';

/**
 * Honest error messages. Every contract error code gets its own sentence; the
 * server's `detail` is used as the fallback so a new backend code still says
 * something useful instead of "Something went wrong".
 */
const CODE_KEYS: Record<string, string> = {
  room_not_found: 'guest.errors.roomNotFound',
  idempotency_key_required: 'guest.errors.generic',
  idempotency_conflict: 'guest.errors.idempotencyConflict',
  trust_required: 'guest.errors.trustRequired',
  item_unavailable: 'guest.errors.itemUnavailable',
  modifier_required: 'guest.errors.modifierRequired',
  refinement_required: 'guest.errors.refinementRequired',
  requested_time_invalid: 'guest.errors.requestedTimeInvalid',
  mixed_categories: 'guest.errors.mixedCategories',
  cancel_not_allowed: 'guest.errors.cancelNotAllowed',
};

export function isNetworkError(error: unknown): boolean {
  return error instanceof NetworkError || (error instanceof ApiError && error.status >= 500);
}

export function errorMessage(error: unknown, t: TFunction): string {
  if (error instanceof NetworkError) return t('guest.errors.offline');
  if (error instanceof ApiError) {
    const key = CODE_KEYS[error.code];
    if (key) return t(key);
    if (error.detail && !/^HTTP \d+$/.test(error.detail)) return error.detail;
    if (error.status >= 500) return t('guest.errors.server');
    return t('guest.errors.generic');
  }
  if (error instanceof Error && error.message) return error.message;
  return t('guest.errors.generic');
}

/** A failed checkout must be retried with the SAME idempotency key. */
export function isRetryableOrderError(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof ApiError) return error.status >= 500 || error.status === 408;
  return false;
}
