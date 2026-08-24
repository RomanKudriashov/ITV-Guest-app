import type { Translated } from '@/api/types';

/** Карточка блока «требует внимания». Форма зависит от кода — см. `attention.ts`. */
export interface DashboardAttention {
  code:
    | 'overdue'
    | 'delivery_failed'
    | 'escalated'
    | 'no_escalation'
    | 'stop_list'
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
    median_pickup_minutes: number | null;
    done: number;
    in_work: number;
  };
  venues: DashboardVenue[];
}
