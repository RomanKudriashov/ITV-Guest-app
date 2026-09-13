import { api } from '@/api/client';
import type { TrackerOrder } from '@/tracker/api/types';

/** Цифры по ТЕКУЩЕЙ выборке — меняются вместе с фильтром. */
export interface OrdersSummary {
  orders: number;
  revenue_minor: number;
  cancelled: number;
  /** Типичная скорость; `null` — закрытых заказов в выборке ещё нет. */
  median_minutes: number | null;
}

export interface OrdersVenue {
  id: string;
  code: string;
  title: string;
}

export interface OrdersPage {
  orders: TrackerOrder[];
  summary: OrdersSummary;
  next_cursor: string | null;
  /** Заведения, о которых этот человек вправе спрашивать. */
  points: OrdersVenue[];
}

export interface OrdersFilters {
  point?: string;
  since?: string;
  until?: string;
  status?: string;
  assignee?: string;
  order_type?: string;
  room?: string;
  search?: string;
}

/**
 * Список заказов отеля. Фильтры уходят НА СЕРВЕР целиком — отсев полученной
 * страницы врал бы счётчиком: «три записи» там, где в базе их триста.
 */
export function fetchOrders(
  filters: OrdersFilters,
  cursor?: string | null,
  limit = 50,
): Promise<OrdersPage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, String(value));
  }
  query.set('limit', String(limit));
  if (cursor) query.set('cursor', cursor);
  return api.get<OrdersPage>(`/cms/orders?${query.toString()}`);
}
