/**
 * ============================================================================
 * NOTIFICATION LOG STATUS TABLE
 * ============================================================================
 *
 * A status decides its colour the same way an order status does on the board:
 * through a TOKEN NAME resolved against the theme (`src/tracker/statusColor.ts`).
 * No literal colour lives here — the project rule is that colours exist only in
 * `src/theme/tokens.ts`.
 */

import { statusSlot, type StatusPaletteSlot } from '@/tracker/statusColor';
import type { NotificationLogEntry } from '@/api/notificationTypes';

export type LogStatus = 'scheduled' | 'sent' | 'failed' | 'skipped' | 'cancelled';

export interface LogStatusSpec {
  status: LogStatus;
  /** Token name, resolved by `statusSlot` — never a colour value. */
  colorToken: string;
  /** Terminal-but-not-delivered states read quieter than the live ones. */
  variant: 'filled' | 'outlined';
}

const SPECS: Record<LogStatus, LogStatusSpec> = {
  scheduled: { status: 'scheduled', colorToken: 'pending', variant: 'outlined' },
  sent: { status: 'sent', colorToken: 'success', variant: 'filled' },
  failed: { status: 'failed', colorToken: 'error', variant: 'filled' },
  skipped: { status: 'skipped', colorToken: 'muted', variant: 'outlined' },
  cancelled: { status: 'cancelled', colorToken: 'cancelled', variant: 'outlined' },
};

export const LOG_STATUSES: LogStatus[] = [
  'scheduled',
  'sent',
  'failed',
  'skipped',
  'cancelled',
];

export function isLogStatus(value: unknown): value is LogStatus {
  return typeof value === 'string' && value in SPECS;
}

export function logStatusSpec(status: string | null | undefined): LogStatusSpec {
  return isLogStatus(status) ? SPECS[status] : SPECS.scheduled;
}

/** Palette slot for a status — `${slot}.main` is what components render. */
export function logStatusSlot(status: string | null | undefined): StatusPaletteSlot {
  return statusSlot(logStatusSpec(status).colorToken);
}

/* ── Two-level grouping ────────────────────────────────────────────────── */

export interface LogNode {
  entry: NotificationLogEntry;
  /** One per channel the step reached; empty for a step that reached nobody. */
  children: NotificationLogEntry[];
}

/**
 * The journal is two-level by design (contract §1): a step writes a PARENT row
 * (`channel_id: null` — "the step fired") and one CHILD row per channel ("the
 * message went out"). Grouping restores that shape so the reader sees
 * "step fired → went to two channels" instead of five unrelated lines.
 *
 * A child whose parent is missing (an older log, a truncated `limit`) is shown
 * at the top level rather than dropped — silence is exactly what this screen
 * exists to prevent.
 */
export function groupLog(entries: NotificationLogEntry[]): LogNode[] {
  const nodes: LogNode[] = [];
  const byStep = new Map<string, LogNode>();

  const stepKey = (entry: NotificationLogEntry) =>
    `${entry.order_id}|${entry.step_id ?? entry.step_index}`;

  for (const entry of entries) {
    if (entry.channel_id) continue;
    const node: LogNode = { entry, children: [] };
    nodes.push(node);
    byStep.set(stepKey(entry), node);
  }

  for (const entry of entries) {
    if (!entry.channel_id) continue;
    const parent = byStep.get(stepKey(entry));
    if (parent) parent.children.push(entry);
    else nodes.push({ entry, children: [] });
  }

  return nodes;
}

/** Flattened render order: a parent immediately followed by its children. */
export function flattenLog(nodes: LogNode[]): { entry: NotificationLogEntry; depth: number }[] {
  const rows: { entry: NotificationLogEntry; depth: number }[] = [];
  for (const node of nodes) {
    rows.push({ entry: node.entry, depth: 0 });
    for (const child of node.children) rows.push({ entry: child, depth: 1 });
  }
  return rows;
}
