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

/**
 * Одна запись журнала переходов — для смены, а не для гостя.
 *
 * Гостевой таймлайн показывает ПУТЬ заказа по потоку. Журнал отвечает на
 * другие вопросы: кто двигал, откуда и был ли это возврат. Разбор смены
 * начинается именно с них.
 */
export interface TrackerJournalEntry {
  /** Статус, ИЗ которого ушли; `null` у самой первой записи. */
  from: string | null;
  to: string;
  title: string;
  at: string;
  /** `staff`, `guest` или `system` — пересчёт агрегата человеком не является. */
  actor_type: string;
  actor_name: string | null;
  /** Движение назад по потоку. Считает сервер: правило живёт в пресете. */
  is_rollback: boolean;
}

export interface TrackerOrder extends GuestOrder {
  execution_point: TrackerPointRef;
  /** Оформил сотрудник за гостя (ресепшен из чата) — кто именно. */
  placed_by?: { id: string; name: string } | null;
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
  /** Что со статусом делали руками: кто, когда, откуда, куда. */
  journal: TrackerJournalEntry[];
  /** Код причины отмены из справочника; `null` у всего, что не отменено. */
  cancel_reason?: string | null;
  /** Та же причина словами — чтобы читать без словаря. */
  cancel_reason_title?: string | null;
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
  median_accept_minutes: number | null;
  /** Начало суток отеля — настоящих смен в модели нет. */
  shift_started_at: string;
  sla_minutes: number;
  /** Последняя заявка вообще — отличает затишье от неработающего экрана. */
  last_order_at: string | null;
}

/** Who is answering a dialog — shown to the rest of the desk, never to the guest. */
export interface ChatHolder {
  id: string;
  name: string;
  /** Computed by REST only; live snapshots compare `id` with the current user. */
  is_me?: boolean;
}

/** One row of the staff thread list (`GET /api/tracker/chat/threads`). */
export interface TrackerChatThread {
  thread_id: string;
  room: string | null;
  /** The guest's language, if known. */
  language?: string;
  last_body?: string | null;
  last_at?: string | null;
  last_guest_at?: string | null;
  /** Unread guest messages in this thread. */
  unread: number;
  /** How long the guest has been waiting for a reply; null — not waiting. */
  waiting_minutes?: number | null;
  /** Waiting longer than the hotel allows — the row turns red. */
  is_late?: boolean;
  holder?: ChatHolder | null;
}

/** A page of dialogs, freshest first; `unread_total` counts all of them. */
export interface TrackerChatThreadsPage {
  items: TrackerChatThread[];
  next_cursor: string | null;
  unread_total: number;
}

/** The staff chat snapshot: the guest shape plus who is answering. */
export type TrackerChatSnapshot = ChatSnapshot & { holder?: ChatHolder | null };

/** One order line of the guest card. */
export interface DeskOrderRow {
  id: string;
  number: number;
  status: {
    code: string;
    title: string;
    color_token?: string;
    is_terminal: boolean;
    is_cancelled: boolean;
  };
  point: string;
  delivery_mode: string;
  created_at: string;
  total: number | null;
  currency: string;
  summary: string;
  extra_count: number;
}

/** The guest card on the reception desk (`GET …/threads/{id}/guest`). */
export interface DeskGuestCard {
  room: string | null;
  language: string;
  room_verified: boolean;
  /** Is the guest's session alive — will a reply reach them. */
  reachable: boolean;
  stay_since: string | null;
  /** Задачи, переданные отделам из этого диалога. */
  tasks: (DeskOrderRow & { comment?: string })[];
  active_orders: DeskOrderRow[];
  history: DeskOrderRow[];
  history_total: number;
  had_low_review: boolean;
  low_reviews: {
    id: string;
    rating: number;
    comment: string;
    order_number: number;
    triage: string;
    at: string;
  }[];
  reviews_count: number;
}

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

export interface TrackerStatusOption {
  code: string;
  title: string;
  color_token?: string;
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
  /**
   * Чем наполнять фильтр «Статус» — приходит ТОЛЬКО для истории.
   *
   * Коды статусов живут в потоке точки («готовится → в пути» у кухни,
   * «в работе → готово» у хозслужбы), поэтому список едет с доской, а не
   * зашит на клиенте. На активной доске его нет: там статус и есть колонка.
   */
  statuses?: TrackerStatusOption[] | null;
  next_cursor?: string | null;
  /**
   * Цифры ПО ТЕКУЩЕЙ ВЫБОРКЕ — приходят только для истории.
   *
   * Сводка смены (`shift`) отвечает на другой вопрос: «как идёт сегодняшняя
   * смена», и считается с полуночи. Над историей без окна она показывала
   * «Сделано 28» при 986 записях в списке — оба числа верные, и ни одно не про
   * то, что видно на экране.
   */
  selection?: {
    orders: number;
    revenue_minor: number;
    cancelled: number;
    median_minutes: number | null;
  } | null;
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
