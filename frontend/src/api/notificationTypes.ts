/**
 * Types mirroring `docs/notifications-api-contract.md`.
 *
 * Kept apart from `api/types.ts` because they mirror a different contract
 * document — the same split the tracker makes.
 */

import type { ChannelType } from '@/notifications/channels';
import type { TargetKind } from '@/notifications/escalation';
import type { LogStatus } from '@/notifications/log';

export interface ChannelTemplate {
  subject: string;
  body: string;
}

export interface NotificationChannel {
  id: string;
  type: ChannelType;
  title: string;
  is_active: boolean;
  /** Department channel. */
  execution_point_id?: string | null;
  /** Personal channel of a member of staff. */
  user_id?: string | null;
  /**
   * Secrets are NEVER returned: the server answers with `config_public`, where
   * `bot_token` reads `••••1234`. `config` appears in requests only.
   */
  config_public?: Record<string, unknown> | null;
  templates?: Record<string, ChannelTemplate> | null;
}

export interface NotificationChannelPayload {
  type: ChannelType;
  title: string;
  is_active?: boolean;
  execution_point_id?: string | null;
  user_id?: string | null;
  /** A secret key is present only when a NEW value is being stored. */
  config?: Record<string, string | string[]>;
  templates?: Record<string, ChannelTemplate>;
}

export interface ChannelTestResult {
  ok: boolean;
  detail?: string;
  error?: string;
}

export interface EscalationStep {
  id: string;
  sort_order: number;
  /** Minutes since the order was created — not since the previous step. */
  delay_minutes: number;
  target_kind: TargetKind;
  channel_id?: string | null;
  title?: string | null;
}

export interface EscalationRule {
  id: string;
  name: string;
  /** `null` — the hotel-wide default rule. */
  execution_point_id?: string | null;
  is_active: boolean;
  steps?: EscalationStep[];
}

export interface EscalationStepPayload {
  sort_order: number;
  delay_minutes: number;
  target_kind: TargetKind;
  channel_id?: string | null;
  title?: string;
}

export interface EscalationRulePayload {
  name: string;
  execution_point_id?: string | null;
  is_active?: boolean;
  /** PATCH replaces the whole set of steps. */
  steps: EscalationStepPayload[];
}

export interface NotificationLogEntry {
  id: string;
  order_id: string;
  order_number: number;
  rule_id?: string | null;
  step_id?: string | null;
  step_index: number;
  /** `null` on the parent row — "the step fired". */
  channel_id?: string | null;
  channel_type?: string | null;
  target_kind?: TargetKind | null;
  status: LogStatus;
  scheduled_for?: string | null;
  sent_at?: string | null;
  attempts?: number;
  error?: string;
  subject?: string;
  body?: string;
  accepted_at_send?: boolean;
}

export interface NotificationLogQuery {
  order_id?: string;
  status?: LogStatus | '';
  limit?: number;
}

/**
 * Members of staff a personal channel can point at.
 *
 * NOTE: the notifications contract references `user_id` but no CMS endpoint
 * that lists staff exists yet, so this call is treated as optional — see
 * `fetchStaffUsers`.
 */
export interface NotificationStaffUser {
  id: string;
  email: string;
  full_name: string;
}

/* ── Event settings (§3а) ─────────────────────────────────────────────── */

/** `channel` — one channel chosen by the hotel; the rest come from the registry. */
export type EventAudience = 'point' | 'lead' | 'manager' | 'hotel' | 'channel';

export interface EventSetting {
  enabled: boolean;
  audience: EventAudience;
  channel_id: string | null;
  /** Empty — any kind of channel. */
  channel_types: ChannelType[];
  /** Only the languages the hotel wrote; a missing language uses the registry text. */
  templates: Record<string, ChannelTemplate>;
  /** The hotel has changed something — otherwise these are the registry defaults. */
  customized: boolean;
}

export interface EventSettingItem {
  code: string;
  title: string;
  audience: EventAudience;
  placeholders: string[];
  enabled_by_default: boolean;
  /** Recipients come from the escalation rules, not from this setting. */
  audience_from_rules: boolean;
  defaults: Record<string, ChannelTemplate>;
  setting: EventSetting;
}

export type EventSettingPayload = Partial<
  Pick<EventSetting, 'enabled' | 'audience' | 'channel_id' | 'channel_types' | 'templates'>
>;

/** Where the preview example came from — always a real case of this hotel. */
export interface EventPreviewSource {
  kind:
    | 'order'
    | 'cancelled_order'
    | 'chat_message'
    | 'review'
    | 'brand_event'
    | 'brand_version'
    | 'failed_delivery';
  at: string | null;
  point: string | null;
  number?: number;
  room?: string;
  rating?: number;
  version?: number | null;
  channel?: string;
}

export interface EventPreviewMessage {
  language: string;
  subject: string;
  body: string;
}

export interface EventPreviewRecipient extends EventPreviewMessage {
  channel_id: string;
  channel_title: string;
  channel_type: ChannelType;
  recipient: string | null;
  step: { title: string; delay_minutes: number } | null;
}

/**
 * `example: null` — the hotel has no such case yet. There is then no message
 * and no recipient list: nothing is invented to fill the frame.
 */
export interface EventPreview {
  enabled: boolean;
  example: { source: EventPreviewSource } | null;
  message: EventPreviewMessage | null;
  recipients: EventPreviewRecipient[] | null;
  rule?: { id: string; name: string } | null;
}
