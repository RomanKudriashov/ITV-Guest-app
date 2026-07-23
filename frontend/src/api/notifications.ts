/** One function per endpoint of `docs/notifications-api-contract.md` §3. */
import { api, request } from './client';
import type {
  ChannelTestResult,
  EscalationRule,
  EscalationRulePayload,
  NotificationChannel,
  NotificationChannelPayload,
  NotificationLogEntry,
  NotificationLogQuery,
  NotificationStaffUser,
} from './notificationTypes';

/* ── Channels ──────────────────────────────────────────────────────────── */

export function fetchNotificationChannels(): Promise<NotificationChannel[]> {
  return api.get<NotificationChannel[]>('/cms/notification-channels');
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
  return api.get<EscalationRule[]>('/cms/escalation-rules');
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
  return api.get<NotificationLogEntry[]>('/cms/notification-log', {
    query: {
      order_id: query.order_id,
      status: query.status || undefined,
      limit: query.limit,
    },
  });
}

/* ── Staff ─────────────────────────────────────────────────────────────── */

/**
 * A personal channel needs a `user_id`. The staff list has a real
 * endpoint (`GET /api/cms/staff`, `docs/hotel-admin-api-contract.md` §4), so the
 * personal-channel picker is populated from it. The call stays best-effort — a
 * failure means "the picker has nothing to offer", never a broken screen.
 */
export async function fetchStaffUsers(): Promise<NotificationStaffUser[]> {
  try {
    const users = await request<NotificationStaffUser[]>('/cms/staff');
    return Array.isArray(users)
      ? users.map((user) => ({
          id: user.id,
          email: user.email,
          full_name: user.full_name,
        }))
      : [];
  } catch {
    return [];
  }
}
