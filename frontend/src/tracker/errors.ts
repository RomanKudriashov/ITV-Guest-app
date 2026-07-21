import type { TFunction } from 'i18next';

import { ApiError } from '@/api/client';

/**
 * Contract error codes get an honest sentence each; anything else falls back to
 * the server's own `detail`, so a new backend code still says something useful.
 */
const CODE_KEYS: Record<string, string> = {
  point_not_assigned: 'tracker.errors.pointNotAssigned',
  invalid_transition: 'tracker.errors.invalidTransition',
  cancel_not_allowed: 'tracker.errors.cancelNotAllowed',
  no_route: 'tracker.errors.noRoute',
  order_not_found: 'tracker.errors.orderNotFound',
  not_found: 'tracker.errors.orderNotFound',
};

/** `409 already_accepted` carries the current executor — name them, don't hide it. */
export function acceptedByName(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'already_accepted') return null;
  const assignee = error.payload.assignee as { name?: string } | undefined;
  if (assignee && typeof assignee.name === 'string' && assignee.name) return assignee.name;
  const name = error.payload.assignee_name;
  return typeof name === 'string' && name ? name : null;
}

export function trackerErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.code === 'already_accepted') {
      const name = acceptedByName(error);
      return name
        ? t('tracker.errors.alreadyAcceptedBy', { name })
        : t('tracker.errors.alreadyAccepted');
    }
    const key = CODE_KEYS[error.code];
    if (key) return t(key);
    // Django's own 404 page has no code — say what actually happened.
    if (error.status === 404) return t('tracker.errors.orderNotFound');
    if (error.status === 403) return t('tracker.errors.pointNotAssigned');
    if (error.detail && !/^HTTP \d+$/.test(error.detail)) return error.detail;
    if (error.status >= 500) return t('tracker.errors.server');
    return t('tracker.errors.generic');
  }
  if (error instanceof Error && error.message) return error.message;
  return t('tracker.errors.generic');
}
