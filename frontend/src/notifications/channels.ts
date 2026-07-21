/**
 * ============================================================================
 * NOTIFICATION CHANNEL TYPE TABLE
 * ============================================================================
 *
 * `docs/notifications-api-contract.md` §1 describes the config of a channel as
 * a TABLE (type → fields → which of them are secret). This file is that table.
 *
 * The channel form reads a row and renders it; it never asks
 * `if (type === 'telegram')`. Adding `sms` or `webhook` must mean adding a row
 * here — the same discipline as `src/offerings/behaviour.ts`.
 */

export type ChannelType = 'telegram' | 'email' | 'log';

/** How one config value is typed in: a single line or a list of lines. */
export type ChannelFieldControl = 'text' | 'list';

export interface ChannelConfigFieldSpec {
  /** Key inside `config` — exactly as the contract names it. */
  name: string;
  control: ChannelFieldControl;
  /**
   * Never comes back from the server (`config_public` masks it). An empty box
   * therefore means "keep what is stored", not "erase".
   */
  secret: boolean;
  required: boolean;
  /** Values are e-mail addresses — checked before the request leaves. */
  email?: boolean;
}

export interface ChannelTypeSpec {
  type: ChannelType;
  fields: ChannelConfigFieldSpec[];
}

const SPECS: Record<ChannelType, ChannelTypeSpec> = {
  telegram: {
    type: 'telegram',
    fields: [
      { name: 'bot_token', control: 'text', secret: true, required: true },
      { name: 'chat_id', control: 'text', secret: false, required: true },
    ],
  },
  email: {
    type: 'email',
    fields: [
      { name: 'to', control: 'list', secret: false, required: true, email: true },
      { name: 'from_email', control: 'text', secret: false, required: false, email: true },
    ],
  },
  // The development / CI adapter: writes into the app log and always succeeds,
  // so a demo hotel can be wired up without real credentials.
  log: { type: 'log', fields: [] },
};

export const CHANNEL_TYPES: ChannelType[] = ['telegram', 'email', 'log'];

export function isChannelType(value: unknown): value is ChannelType {
  return typeof value === 'string' && value in SPECS;
}

/** Unknown types fall back to `log` — the only row that can never misfire. */
export function channelSpec(type: string | null | undefined): ChannelTypeSpec {
  return isChannelType(type) ? SPECS[type] : SPECS.log;
}

/* ── Binding: department / employee / hotel-wide ───────────────────────── */

export type ChannelBinding = 'hotel' | 'point' | 'user';

export const CHANNEL_BINDINGS: ChannelBinding[] = ['hotel', 'point', 'user'];

export function bindingOf(channel: {
  execution_point_id?: string | null;
  user_id?: string | null;
}): ChannelBinding {
  if (channel.user_id) return 'user';
  if (channel.execution_point_id) return 'point';
  return 'hotel';
}

/* ── Draft shape ───────────────────────────────────────────────────────── */

/** Config as typed in: every value is a string, lists are newline-separated. */
export type ChannelConfigDraft = Record<string, string>;

export interface ChannelTemplateDraft {
  subject: string;
  body: string;
}

export interface ChannelDraft {
  id?: string;
  type: ChannelType;
  title: string;
  is_active: boolean;
  binding: ChannelBinding;
  execution_point_id: string | null;
  user_id: string | null;
  config: ChannelConfigDraft;
  /** Per language; empty languages are dropped on save. */
  templates: Record<string, ChannelTemplateDraft>;
}

/** Placeholders the server substitutes — shown to the author as a hint. */
export const TEMPLATE_PLACEHOLDERS = [
  'number',
  'room',
  'point',
  'summary',
  'comment',
] as const;

export function emptyChannel(): ChannelDraft {
  return {
    type: 'log',
    title: '',
    is_active: true,
    binding: 'hotel',
    execution_point_id: null,
    user_id: null,
    config: {},
    templates: {},
  };
}

function listToText(value: unknown): string {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join('\n');
  return value === null || value === undefined ? '' : String(value);
}

function textToList(value: string): string[] {
  return value
    .split(/[\n,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Server channel → draft. Secret fields are seeded EMPTY on purpose: the mask
 * (`••••1234`) is a label, not a value, and sending it back would store the
 * dots as the real token.
 */
export function channelToDraft(
  channel: {
    id: string;
    type: string;
    title: string;
    is_active: boolean;
    execution_point_id?: string | null;
    user_id?: string | null;
    config_public?: Record<string, unknown> | null;
    templates?: Record<string, { subject?: string; body?: string }> | null;
  },
): ChannelDraft {
  const spec = channelSpec(channel.type);
  const source = channel.config_public ?? {};
  const config: ChannelConfigDraft = {};
  for (const field of spec.fields) {
    if (field.secret) {
      config[field.name] = '';
      continue;
    }
    // `listToText` handles both shapes: a list joins with newlines, a scalar
    // stringifies — so a masked `chat_id` shows exactly what the server sent.
    config[field.name] = listToText(source[field.name]);
  }

  const templates: Record<string, ChannelTemplateDraft> = {};
  for (const [code, template] of Object.entries(channel.templates ?? {})) {
    templates[code] = { subject: template?.subject ?? '', body: template?.body ?? '' };
  }

  return {
    id: channel.id,
    type: spec.type,
    title: channel.title ?? '',
    is_active: channel.is_active,
    binding: bindingOf(channel),
    execution_point_id: channel.execution_point_id ?? null,
    user_id: channel.user_id ?? null,
    config,
    templates,
  };
}

/** The masked value the server shows for a secret that is already stored. */
export function maskedSecret(
  configPublic: Record<string, unknown> | null | undefined,
  name: string,
): string {
  const value = configPublic?.[name];
  return typeof value === 'string' ? value : '';
}

/* ── Validation — mirrors `422 channel_config_invalid` ─────────────────── */

export interface ChannelValidationError {
  /** `title`, `execution_point_id`, `user_id` or `config.<name>`. */
  field: string;
  messageKey: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateChannel(draft: ChannelDraft): ChannelValidationError[] {
  const errors: ChannelValidationError[] = [];

  if (!draft.title.trim()) {
    errors.push({ field: 'title', messageKey: 'notifications.validation.titleRequired' });
  }
  if (draft.binding === 'point' && !draft.execution_point_id) {
    errors.push({ field: 'execution_point_id', messageKey: 'notifications.validation.pointRequired' });
  }
  if (draft.binding === 'user' && !draft.user_id) {
    errors.push({ field: 'user_id', messageKey: 'notifications.validation.userRequired' });
  }

  for (const field of channelSpec(draft.type).fields) {
    const raw = (draft.config[field.name] ?? '').trim();
    const values = field.control === 'list' ? textToList(raw) : raw ? [raw] : [];

    if (field.required && values.length === 0) {
      // A stored secret stays valid while the box is empty — that is the whole
      // point of "leave blank to keep".
      if (!(field.secret && draft.id)) {
        errors.push({
          field: `config.${field.name}`,
          messageKey: 'notifications.validation.configRequired',
        });
      }
      continue;
    }

    if (field.email && values.some((value) => !EMAIL_RE.test(value))) {
      errors.push({
        field: `config.${field.name}`,
        messageKey: 'notifications.validation.emailInvalid',
      });
    }
  }

  return errors;
}

/**
 * Draft → request body. Only the fields of the chosen type are sent, and a
 * secret only when the author actually typed a new one.
 */
export function channelPayload(draft: ChannelDraft): {
  type: ChannelType;
  title: string;
  is_active: boolean;
  execution_point_id: string | null;
  user_id: string | null;
  config: Record<string, string | string[]>;
  templates: Record<string, ChannelTemplateDraft>;
} {
  const config: Record<string, string | string[]> = {};
  for (const field of channelSpec(draft.type).fields) {
    const raw = (draft.config[field.name] ?? '').trim();
    if (field.secret && !raw) continue; // keep the stored secret
    if (field.control === 'list') {
      config[field.name] = textToList(raw);
    } else if (raw || !field.secret) {
      config[field.name] = raw;
    }
  }

  const templates: Record<string, ChannelTemplateDraft> = {};
  for (const [code, template] of Object.entries(draft.templates)) {
    const subject = template.subject.trim();
    const body = template.body.trim();
    if (subject || body) templates[code] = { subject, body };
  }

  return {
    type: draft.type,
    title: draft.title.trim(),
    is_active: draft.is_active,
    execution_point_id: draft.binding === 'point' ? draft.execution_point_id : null,
    user_id: draft.binding === 'user' ? draft.user_id : null,
    config,
    templates,
  };
}
