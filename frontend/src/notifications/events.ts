/**
 * Event settings: the draft a hotel edits and what is sent to the server.
 *
 * The same draft goes to «save» and to «preview» — a preview built from
 * something other than what will be saved would show a message nobody gets.
 */

import type {
  ChannelTemplate,
  EventAudience,
  EventSettingItem,
  EventSettingPayload,
} from '@/api/notificationTypes';
import type { ChannelType } from './channels';

export interface EventDraft {
  enabled: boolean;
  audience: EventAudience;
  channelId: string;
  channelTypes: ChannelType[];
  /** Every language the screen shows; empty subject and body — the registry text. */
  templates: Record<string, ChannelTemplate>;
}

export const AUDIENCES: EventAudience[] = ['point', 'lead', 'manager', 'hotel', 'channel'];

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

export function eventToDraft(item: EventSettingItem): EventDraft {
  return {
    enabled: item.setting.enabled,
    audience: item.setting.audience,
    channelId: item.setting.channel_id ?? '',
    channelTypes: [...item.setting.channel_types],
    templates: Object.fromEntries(
      Object.entries(item.setting.templates ?? {}).map(([language, template]) => [
        language,
        { subject: template.subject ?? '', body: template.body ?? '' },
      ]),
    ),
  };
}

/** What the registry decides — «вернуть по умолчанию». */
export function defaultDraft(item: EventSettingItem): EventDraft {
  return {
    enabled: item.enabled_by_default,
    audience: item.audience,
    channelId: '',
    channelTypes: [],
    templates: {},
  };
}

export function eventPayload(draft: EventDraft, item: EventSettingItem): EventSettingPayload {
  const templates: Record<string, ChannelTemplate> = {};
  for (const [language, template] of Object.entries(draft.templates)) {
    const subject = template.subject.trim();
    const body = template.body.trim();
    if (subject || body) templates[language] = { subject, body };
  }
  if (item.audience_from_rules) {
    // Recipients of this event belong to the escalation rules — never sent.
    return { enabled: draft.enabled, templates };
  }
  return {
    enabled: draft.enabled,
    audience: draft.audience,
    channel_id: draft.audience === 'channel' ? draft.channelId || null : null,
    channel_types: draft.channelTypes,
    templates,
  };
}

export function isDirty(draft: EventDraft, item: EventSettingItem): boolean {
  return (
    JSON.stringify(eventPayload(draft, item)) !==
    JSON.stringify(eventPayload(eventToDraft(item), item))
  );
}

/** `{{numbr}}` — caught before the request, the same rule the server applies. */
export function unknownPlaceholders(text: string, allowed: string[]): string[] {
  const known = new Set(allowed);
  const found = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (!known.has(match[1])) found.add(match[1]);
  }
  return [...found];
}

/** Half a hotel text and half a registry text is a message nobody wrote whole. */
export function isIncomplete(template: ChannelTemplate | undefined): boolean {
  if (!template) return false;
  const subject = template.subject.trim();
  const body = template.body.trim();
  return Boolean(subject) !== Boolean(body);
}

export function draftProblems(draft: EventDraft, item: EventSettingItem): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const [language, template] of Object.entries(draft.templates)) {
    for (const field of ['subject', 'body'] as const) {
      const unknown = unknownPlaceholders(template[field], item.placeholders);
      if (unknown.length) problems[`templates.${language}.${field}`] = `unknown:${unknown.join(',')}`;
    }
    if (isIncomplete(template)) {
      problems[`templates.${language}.${template.subject.trim() ? 'body' : 'subject'}`] =
        'incomplete';
    }
  }
  if (!item.audience_from_rules && draft.audience === 'channel' && !draft.channelId) {
    problems.channel_id = 'channel_required';
  }
  return problems;
}
