/**
 * Tracker API types — mirror of `docs/tracker-api-contract.md`.
 *
 * The board order is a superset of the guest order (§3 of the contract): the
 * same object plus what the executor needs. Reusing `GuestOrder` is deliberate —
 * the timeline component and the money helpers keep working unchanged.
 */

import type { ChatSnapshot, GuestOrder, GuestReview } from '@/guest/api/types';

export type TrackerScope = 'active' | 'history';

/**
 * Kind of tracker, derived by the server from the service type — never guessed
 * here. A board for a restaurant, a queue for housekeeping, a day of bookings
 * for a spa, a request list for the concierge.
 */
export type TrackerType = 'board' | 'queue' | 'schedule' | 'requests';

/** How to draw the tasks. The server says which; the client never decides. */
export type TrackerLayout = 'columns' | 'timeline';

export interface TrackerPoint {
  id: string;
  code: string;
  title: string;
  kind?: string;
  /** Порог просрочки этой точки, минуты. У кухни и у консьержа он разный. */
  sla_minutes?: number;
  tracker_type?: TrackerType;
  layout?: TrackerLayout;
  /** Staff level on this point ("lead", "member", …) — informational. */
  level?: string;
  active_count?: number;
  new_count?: number;
}

export interface TrackerPointsResponse {
  points: TrackerPoint[];
}

export interface TrackerPointRef {
  id: string;
  code: string;
  title: string;
  /** Порог просрочки этой точки, минуты — тот же `serialize_point` на сервере. */
  sla_minutes?: number;
  /** `point` — задан руками, `type` — умолчание вида работы. */
  sla_source?: 'point' | 'type';
  tracker_type?: TrackerType;
  layout?: TrackerLayout;
}

/**
 * Where a borrowed task came from (R2 fan-out → R3 board).
 *
 * A cocktail ordered through room service is prepared by the bar and lands on
 * the bar's board as its own sub-order with its own number. Without this the
 * bartender sees a task from nowhere: the guest will quote the number of *their*
 * order, and that number is not on the board.
 */
export interface TrackerSourceOrder {
  id: string;
  number: number;
  service_code: string;
  service_title: string;
}

export interface TrackerAssignee {
  id: string;
  name: string;
}

/** Where the order may go from its current status — computed by the server. */
export interface TrackerNextStatus {
  code: string;
  title: string;
  color_token?: string;
}

export interface TrackerOrder extends GuestOrder {
  execution_point: TrackerPointRef;
  assignee: TrackerAssignee | null;
  accepted_at: string | null;
  /** How long the order has been waiting, minutes. */
  waiting_minutes: number;
  /** Waiting longer than the point's threshold. */
  is_overdue: boolean;
  /**
   * НА СКОЛЬКО просрочен, минуты; `null`, когда не просрочен.
   *
   * Считает сервер: порог живёт в настройке точки (`sla_minutes`), и вычитание
   * на клиенте завело бы второе место, где записано, что такое просрочка.
   */
  overdue_minutes: number | null;
  next_statuses: TrackerNextStatus[];
  can_cancel: boolean;
  /** Set only on a sub-order of a fanned-out guest order; null on a plain one. */
  source_order?: TrackerSourceOrder | null;
  /** The guest's private review, once left — shown on the card/detail if present. */
  review?: GuestReview | null;
}

/**
 * Сводка смены точки. Едет ВМЕСТЕ с доской, а не отдельной ручкой: числа
 * обязаны совпадать с тем, что видно в колонках, а второй запрос разошёлся бы
 * с первым на любом заказе, пришедшем между ними.
 */
export interface TrackerShift {
  /** Сейчас: невзятые, в работе, просроченные. Первые три — ещё и фильтры. */
  new: number;
  in_work: number;
  overdue: number;
  /** За смену: закрытых без отмен. */
  done: number;
  /** Медиана «создан → закрыт», минуты. `null` — за смену нечего мерить. */
  median_minutes: number | null;
  /** Медиана «создан → взят», минуты. Скорость РЕАКЦИИ, отдельно от исполнения. */
  median_pickup_minutes: number | null;
  /** Начало суток отеля — настоящих смен в модели нет. */
  shift_started_at: string;
  sla_minutes: number;
  /** Последняя заявка вообще — отличает затишье от неработающего экрана. */
  last_order_at: string | null;
}

/** One row of the staff thread list (`GET /api/tracker/chat/threads`). */
export interface TrackerChatThread {
  thread_id: string;
  room: string | null;
  last_body?: string | null;
  last_at?: string | null;
  /** Unread guest messages in this thread. */
  unread: number;
}

/** The staff chat snapshot is the same shape as the guest one (contract §3). */
export type TrackerChatSnapshot = ChatSnapshot;

/**
 * Заявки одной комнаты. Приходит только у трекеров, которые работают ПО
 * НОМЕРАМ (хозслужба): горничная идёт по этажу, и две заявки в один номер —
 * это один поход, а не два.
 */
export interface TrackerRoomGroup {
  key: string;
  room: string;
  orders: TrackerOrder[];
}

export interface TrackerColumn {
  code: string;
  title: string;
  /**
   * Плоский список — ВСЕГДА. По нему считаются счётчики, поиск и всё, что не
   * знает про группы; `groups` — дополнение к нему, а не замена.
   */
  orders: TrackerOrder[];
  /** Группировка по комнатам, если её задал реестр поведения трекера. */
  groups?: TrackerRoomGroup[];
  /** Timeline layout only: which day this column shows (YYYY-MM-DD). */
  date?: string;
}

export interface TrackerBoard {
  point: TrackerPointRef;
  scope: TrackerScope;
  server_time: string;
  tracker_type?: TrackerType;
  layout?: TrackerLayout;
  /** Built from the point's status FLOW — never hard-coded on the client. */
  columns: TrackerColumn[];
  /** Сводка смены — приезжает в том же ответе и в том же снимке из сокета. */
  shift?: TrackerShift;
  /**
   * Кого предлагать в фильтре «исполнитель» — ПРИВЯЗАННЫЕ к точке, а не те,
   * кто попался на доске: смена с нулём заказов обязана быть в списке, иначе
   * управляющий не проверит, почему у человека пусто.
   */
  assignees?: TrackerAssignee[];
  next_cursor?: string | null;
}

/** WebSocket envelope — full snapshots only, never deltas (contract §5). */
export interface TrackerSnapshotMessage {
  type: 'tracker.snapshot';
  /** `connected` for the first snapshot, otherwise the event that fired. */
  event?: string;
  order_id?: string;
  board: TrackerBoard;
}

export interface TrackerPingMessage {
  type: 'ping';
}

export type TrackerSocketMessage =
  | TrackerSnapshotMessage
  | TrackerPingMessage
  | { type: string };

export interface StatusChangePayload {
  status: string;
  comment?: string;
}
