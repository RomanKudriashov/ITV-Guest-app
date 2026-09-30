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

/* ── Квитанция канала против ошибки ─────────────────────────────────────── */

/*
  ОДНО ПОЛЕ, ДВА РАЗНЫХ СМЫСЛА — И ЭТО НЕ НАША ВОЛЬНОСТЬ, А ФАКТ ХРАНЕНИЯ.

  Сервер кладёт в `error` и текст ошибки (когда отправка не удалась), и ОТВЕТ
  КАНАЛА, когда удалась: `delivery.py` пишет туда `reference` от адаптера.
  У лог-канала это слово `logged`, у почты и телеграма — идентификатор
  сообщения. Экран показывал поле одной колонкой «Ошибка» и красным, поэтому у
  успешной строки рядом с зелёным «Отправлено» горело красное `logged`.

  Читается это как «отправлено, но что-то сломалось», и на разборе 24.09.2026
  именно так и прочли. Здесь решается, что из поля показать как ошибку, а что —
  как квитанцию; цвет и колонку выбирает уже компонент.
*/

/*
  ТРЕТИЙ СМЫСЛ — ПРИЧИНА (партия 23, бэклог 40). У отменённой ступени в поле
  лежит «Заказ взят в работу» — не ошибка, а ровно то, ради чего эскалация и
  заводилась: успели принять. У пропущенной — «не нашлось активных каналов»:
  тоже не сбой отправки, отправлять было некуда. Красной «Ошибкой» обе
  читались как поломка доставки.

  Разведение: «Ошибка» — только у `failed`, красным. Всё остальное, что лежит в
  поле, — ПОЯСНЕНИЕ, в одной колонке с квитанцией: у строки всегда ровно один
  из смыслов (квитанция у отправленной, причина у отменённой или пропущенной),
  и вторая колонка стояла бы пустой почти всегда. Отмена — спокойным цветом,
  пропуск — предупреждающим: на пропущенной ступени не уведомлён никто, и это
  стоит заметить, хотя это и не сбой.
*/

/** Известные слова в поле, у которых есть человеческое имя. Прочие — как есть. */
const NOTE_KEYS: Record<string, string> = {
  logged: 'notifications.log.receipts.logged',
  // Сервер пишет причины по-русски в двух местах (`delivery.py`): гашение при
  // приёме (`cancel_pending`) и проверка перед отправкой ступени. Оба «принят»
  // ведут к одной подписи — для читающего это одно и то же событие.
  'Заказ взят в работу': 'notifications.log.reasons.accepted',
  'Заказ уже в работе — эскалация не нужна': 'notifications.log.reasons.accepted',
  'Отель выключил уведомления о просрочке': 'notifications.log.reasons.eventDisabled',
  'Для этой ступени не нашлось активных каналов': 'notifications.log.reasons.noChannels',
};

export interface DeliveryNote {
  /** Настоящая ошибка отправки: колонка «Ошибка», красным. Только у `failed`. */
  failure: string;
  /** Пояснение: квитанция канала, причина отмены или пропуска. */
  receipt: string;
  /** Ключ перевода пояснения, если это известное слово, а не id письма. */
  receiptKey: string | null;
  /** Тон пояснения: спокойный — квитанция и отмена; предупреждение — пропуск. */
  tone: 'quiet' | 'warning';
}

export function deliveryNote(entry: {
  status?: string | null;
  error?: string | null;
}): DeliveryNote {
  const value = (entry.error ?? '').trim();
  if (entry.status === 'failed') {
    return { failure: value, receipt: '', receiptKey: null, tone: 'quiet' };
  }
  return {
    failure: '',
    receipt: value,
    receiptKey: NOTE_KEYS[value] ?? null,
    tone: entry.status === 'skipped' ? 'warning' : 'quiet',
  };
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
