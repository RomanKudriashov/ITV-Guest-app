import type { ListPage } from './types';
/** One function per endpoint of `docs/notifications-api-contract.md` §3. */
import { api } from './client';
import type {
  ChannelTestResult,
  EscalationRule,
  EscalationRulePayload,
  EventPreview,
  EventSetting,
  EventSettingItem,
  EventSettingPayload,
  NotificationChannel,
  NotificationChannelPayload,
  NotificationLogEntry,
  NotificationLogQuery,
  NotificationStaffUser,
} from './notificationTypes';

/* ── Channels ──────────────────────────────────────────────────────────── */

export function fetchNotificationChannels(): Promise<NotificationChannel[]> {
  return api
    .get<ListPage<NotificationChannel>>('/cms/notification-channels')
    .then((page) => page.items);
}

export function createNotificationChannel(
  payload: NotificationChannelPayload,
): Promise<NotificationChannel> {
  return api.post<NotificationChannel>('/cms/notification-channels', payload);
}

export function updateNotificationChannel(
  id: string,
  payload: Partial<NotificationChannelPayload>,
): Promise<NotificationChannel> {
  return api.patch<NotificationChannel>(`/cms/notification-channels/${id}`, payload);
}

export function deleteNotificationChannel(id: string): Promise<void> {
  return api.delete<void>(`/cms/notification-channels/${id}`);
}

/**
 * Sends a probe message. Configuring a channel blind and waiting for the first
 * real request to discover a typo in the token is not an option.
 */
export function testNotificationChannel(id: string): Promise<ChannelTestResult> {
  return api.post<ChannelTestResult>(`/cms/notification-channels/${id}/test`);
}

/* ── Escalation rules ──────────────────────────────────────────────────── */

export function fetchEscalationRules(): Promise<EscalationRule[]> {
  return api.get<ListPage<EscalationRule>>('/cms/escalation-rules').then((page) => page.items);
}

export function createEscalationRule(payload: EscalationRulePayload): Promise<EscalationRule> {
  return api.post<EscalationRule>('/cms/escalation-rules', payload);
}

/** `steps` replace the whole set — the contract is explicit about this. */
export function updateEscalationRule(
  id: string,
  payload: Partial<EscalationRulePayload>,
): Promise<EscalationRule> {
  return api.patch<EscalationRule>(`/cms/escalation-rules/${id}`, payload);
}

export function deleteEscalationRule(id: string): Promise<void> {
  return api.delete<void>(`/cms/escalation-rules/${id}`);
}

/* ── Journal ───────────────────────────────────────────────────────────── */

/** Newest first. */
export function fetchNotificationLog(
  query: NotificationLogQuery = {},
): Promise<NotificationLogEntry[]> {
  return api
    .get<ListPage<NotificationLogEntry>>('/cms/notification-log', {
      query: {
        order_id: query.order_id,
        status: query.status || undefined,
        limit: query.limit,
      },
    })
    .then((page) => page.items);
}

/* ── Event settings ────────────────────────────────────────────────────── */

export function fetchEventSettings(): Promise<EventSettingItem[]> {
  return api
    .get<{ items: EventSettingItem[] }>('/cms/notification-events/settings')
    .then((page) => page.items);
}

/** Fields left out are not changed. */
export function saveEventSetting(code: string, payload: EventSettingPayload): Promise<EventSetting> {
  return api.put<EventSetting>(
    `/cms/notification-events/settings/${encodeURIComponent(code)}`,
    payload,
  );
}

/**
 * «Вот так придёт» — the draft applied to the latest REAL case of the hotel.
 * Saves nothing and sends nothing.
 */
export function previewEvent(
  code: string,
  payload: EventSettingPayload & { language?: string },
): Promise<EventPreview> {
  return api.post<EventPreview>(
    `/cms/notification-events/settings/${encodeURIComponent(code)}/preview`,
    payload,
  );
}

/* ── Staff ─────────────────────────────────────────────────────────────── */

/**
 * A personal channel needs a `user_id`, and the picker is filled from
 * `GET /api/cms/staff` (`docs/hotel-admin-api-contract.md` §4).
 *
 * Выдача приходит КОНВЕРТОМ `{items, total, …}`, как у всех листингов CMS, —
 * разворачиваем её здесь, а не гадаем на `Array.isArray` снаружи.
 *
 * Отказ НЕ проглатывается. Пустой список от упавшего запроса неотличим от
 * отеля без сотрудников, и поле «Сотрудник» молча блокировалось бы с подписью
 * «сотрудников нет» — экран врал бы про состояние отеля вместо того, чтобы
 * сказать «список не загрузился».
 */
export function fetchStaffUsers(): Promise<NotificationStaffUser[]> {
  return api
    .get<ListPage<NotificationStaffUser>>('/cms/staff')
    .then((page) =>
      page.items.map((user) => ({
        id: user.id,
        email: user.email,
        full_name: user.full_name,
      })),
    );
}
