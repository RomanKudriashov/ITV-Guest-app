/**
 * ============================================================================
 * ESCALATION TARGET TABLE + step drafts
 * ============================================================================
 *
 * `docs/notifications-api-contract.md` §1 lists the targets of a step as a
 * table. This is that table, plus the local draft shape of a rule and the
 * mirror of the server's 422s so the author sees the problem before saving.
 *
 * `delay_minutes` is counted FROM THE CREATION OF THE ORDER, not from the
 * previous step — retuning one step never shifts the rest.
 */

export type TargetKind = 'point' | 'lead' | 'manager' | 'channel';

export interface TargetSpec {
  kind: TargetKind;
  /** `channel_id` is meaningful (and mandatory) only here — `422 channel_required`. */
  requiresChannel: boolean;
}

const TARGETS: Record<TargetKind, TargetSpec> = {
  point: { kind: 'point', requiresChannel: false },
  lead: { kind: 'lead', requiresChannel: false },
  manager: { kind: 'manager', requiresChannel: false },
  channel: { kind: 'channel', requiresChannel: true },
};

export const TARGET_KINDS: TargetKind[] = ['point', 'lead', 'manager', 'channel'];

export function isTargetKind(value: unknown): value is TargetKind {
  return typeof value === 'string' && value in TARGETS;
}

export function targetSpec(kind: string | null | undefined): TargetSpec {
  return isTargetKind(kind) ? TARGETS[kind] : TARGETS.point;
}

/* ── Draft shape ───────────────────────────────────────────────────────── */

export interface StepDraft {
  /** Stable local key — steps are reordered before they exist on the server. */
  key: string;
  id?: string;
  /** Kept as text so an empty box is "not filled in", not zero. */
  delayInput: string;
  target_kind: TargetKind;
  channel_id: string | null;
  title: string;
}

export interface RuleDraft {
  id?: string;
  name: string;
  execution_point_id: string | null;
  is_active: boolean;
  steps: StepDraft[];
}

export function newKey(): string {
  return Math.random().toString(36).slice(2);
}

export function emptyStep(delayMinutes = 0): StepDraft {
  return {
    key: newKey(),
    delayInput: String(delayMinutes),
    target_kind: 'point',
    channel_id: null,
    title: '',
  };
}

export function emptyRule(executionPointId: string | null = null): RuleDraft {
  return {
    name: '',
    execution_point_id: executionPointId,
    is_active: true,
    steps: [emptyStep(0)],
  };
}

export function parseDelay(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Drops what the chosen target cannot carry — a `point` step has no channel. */
export function normalizeStep(step: StepDraft): StepDraft {
  return {
    ...step,
    channel_id: targetSpec(step.target_kind).requiresChannel ? step.channel_id : null,
  };
}

export function ruleToDraft(rule: {
  id: string;
  name: string;
  execution_point_id?: string | null;
  is_active: boolean;
  steps?: {
    id: string;
    sort_order: number;
    delay_minutes: number;
    target_kind: string;
    channel_id?: string | null;
    title?: string | null;
  }[];
}): RuleDraft {
  return {
    id: rule.id,
    name: rule.name ?? '',
    execution_point_id: rule.execution_point_id ?? null,
    is_active: rule.is_active,
    steps: (rule.steps ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((step) =>
        normalizeStep({
          key: step.id,
          id: step.id,
          delayInput: String(step.delay_minutes),
          target_kind: isTargetKind(step.target_kind) ? step.target_kind : 'point',
          channel_id: step.channel_id ?? null,
          title: step.title ?? '',
        }),
      ),
  };
}

/* ── Validation — one row per server 422 code ──────────────────────────── */

export interface RuleValidationError {
  /** `rule`, `execution_point_id`, `step:<key>:delay`, `step:<key>:channel`. */
  target: string;
  messageKey: string;
  /** The server code this local check mirrors — kept so both land identically. */
  code: string;
}

/**
 * Mirrors §3 of the contract exactly:
 *   `rule_without_steps`, `steps_out_of_order`, `duplicate_delay`,
 *   `channel_required`.
 * The server stays the source of truth; its 422s are routed onto the same
 * targets by `serverErrorTarget`.
 */
export function validateRule(draft: RuleDraft): RuleValidationError[] {
  const errors: RuleValidationError[] = [];

  if (draft.steps.length === 0) {
    errors.push({
      target: 'rule',
      messageKey: 'notifications.validation.ruleWithoutSteps',
      code: 'rule_without_steps',
    });
    return errors;
  }

  const seenDelays = new Set<number>();
  let previous: number | null = null;

  for (const step of draft.steps) {
    const delay = parseDelay(step.delayInput);

    if (delay === null) {
      errors.push({
        target: `step:${step.key}:delay`,
        messageKey: 'notifications.validation.delayInvalid',
        code: 'delay_invalid',
      });
    } else {
      if (seenDelays.has(delay)) {
        errors.push({
          target: `step:${step.key}:delay`,
          messageKey: 'notifications.validation.duplicateDelay',
          code: 'duplicate_delay',
        });
      } else if (previous !== null && delay < previous) {
        errors.push({
          target: `step:${step.key}:delay`,
          messageKey: 'notifications.validation.stepsOutOfOrder',
          code: 'steps_out_of_order',
        });
      }
      seenDelays.add(delay);
      previous = delay;
    }

    if (targetSpec(step.target_kind).requiresChannel && !step.channel_id) {
      errors.push({
        target: `step:${step.key}:channel`,
        messageKey: 'notifications.validation.channelRequired',
        code: 'channel_required',
      });
    }
  }

  return errors;
}

/**
 * Where a server error belongs on screen. Codes that name a single offending
 * step are pinned onto the first step the local checks flag; the rest are
 * rule-level.
 */
export function serverErrorTarget(code: string, draft: RuleDraft): string {
  const local = validateRule(draft).find((error) => error.code === code);
  if (local) return local.target;

  if (code === 'rule_already_exists') return 'execution_point_id';
  if (code === 'rule_without_steps') return 'rule';
  return 'rule';
}

export function rulePayload(draft: RuleDraft): {
  name: string;
  execution_point_id: string | null;
  is_active: boolean;
  steps: {
    sort_order: number;
    delay_minutes: number;
    target_kind: TargetKind;
    channel_id: string | null;
    title: string;
  }[];
} {
  return {
    name: draft.name.trim(),
    execution_point_id: draft.execution_point_id,
    is_active: draft.is_active,
    steps: draft.steps.map((step, index) => ({
      sort_order: index,
      delay_minutes: parseDelay(step.delayInput) ?? 0,
      target_kind: step.target_kind,
      channel_id: targetSpec(step.target_kind).requiresChannel ? step.channel_id : null,
      title: step.title.trim(),
    })),
  };
}
