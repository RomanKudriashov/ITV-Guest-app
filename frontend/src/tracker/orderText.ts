import type { TFunction } from 'i18next';

import type { TrackerOrder } from './api/types';

export function formatClock(iso: string | null | undefined, language: string): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(iso),
    );
  } catch {
    return '';
  }
}

/** «Комната 305 · Бассейн · шезлонг 12» — everything the runner needs in one line. */
export function whereText(order: TrackerOrder, t: TFunction): string {
  const parts: string[] = [];
  if (order.room) parts.push(t('tracker.card.room', { room: order.room }));
  if (order.location?.title) parts.push(order.location.title);
  if (order.location?.refinement) parts.push(order.location.refinement);
  return parts.join(' · ') || '—';
}

/** ASAP or "by 19:30" — the delivery promise, not the creation time. */
export function whenText(order: TrackerOrder, t: TFunction, language: string): string {
  if (order.requested_time) {
    return t('tracker.card.byTime', { time: formatClock(order.requested_time, language) });
  }
  return t('tracker.card.asap');
}

/** Short composition: "2× Борщ · 1× Компот". */
export function itemsSummary(order: TrackerOrder): string {
  return order.items.map((line) => `${line.quantity}× ${line.title}`).join(' · ');
}

/**
 * The money on the card. `total: null` means the offering has no price at all —
 * a dash is honest, "0 ₽" is not.
 */
export function totalText(
  order: TrackerOrder,
  format: (minor: number, currency?: string) => string,
): string {
  return order.total === null || order.total === undefined
    ? '—'
    : format(order.total, order.currency);
}
