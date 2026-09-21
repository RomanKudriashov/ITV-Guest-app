import type { Translated } from '@/api/types';

/** Карточка блока «требует внимания». Форма зависит от кода — см. `attention.ts`. */
export interface DashboardAttention {
  code:
    | 'overdue'
    | 'delivery_failed'
    | 'escalated'
    | 'no_escalation'
    | 'stop_list'
    | 'reviews_awaiting'
    | 'node_offline'
    | 'tariff_over';
  severity: 'error' | 'warning';
  /** Куда идти чинить. Считает сервер: экран не выдумывает адресов. */
  route: string;
  count?: number;
  /** Только у `node_offline`. */
  minutes?: number;
  /** Только у `tariff_over`. */
  resource?: string;
  used?: number;
  limit?: number;
  /** Только у `no_escalation`: чьи именно заведения. */
  names?: string[];
  /** Только у `reviews_awaiting`: сколько из ждущих — с низкой оценкой. */
  low?: number;
}

/** Отзыв на пульте: строка работы, а не читалка. Полный текст — по ссылке. */
export interface DashboardReview {
  id: string;
  rating: number;
  comment: string;
  created_at: string;
  order_number: number | null;
  route: string;
}

export interface DashboardVenue {
  code: string;
  title: Translated;
  in_work: number;
  new: number;
  overdue: number;
  /** Медиана исполнения. `null` — за смену нечего мерить. */
  median_minutes: number | null;
  route: string;
}

export interface DashboardData {
  scope: { all_points: boolean; points_count: number };
  attention: DashboardAttention[];
  today: {
    orders: number;
    orders_delta: number | null;
    revenue_minor: number | null;
    revenue_delta: number | null;
    avg_rating: number | null;
    rating_delta: number | null;
    /** `null` у управляющего заведением: сессия к точке не привязана. */
    live_guests: number | null;
    median_minutes: number | null;
    median_accept_minutes: number | null;
    done: number;
    in_work: number;
  };
  venues: DashboardVenue[];
  /**
   * Отзывы, с которыми надо что-то делать. `items` — последние низкие,
   * ждущие ответа; пятёрка без ответа подождёт.
   */
  reviews: {
    awaiting: number;
    low_awaiting: number;
    items: DashboardReview[];
  };
}
