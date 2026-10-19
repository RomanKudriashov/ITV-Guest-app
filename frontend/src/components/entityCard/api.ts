import { api } from '@/api/client';

/**
 * Данные карточек — `/api/v1/cards/{type}/{key}` (партия 59а). Лёгкие ручки:
 * не больше 4 запросов к базе, права — на сервере (`apps/hotels/services/cards.py`).
 */

export type EntityType = 'order' | 'room' | 'venue';

export interface OrderCardData {
  type: 'order';
  id: string;
  number: number;
  room: string | null;
  location: string | null;
  delivery_mode: string;
  venue: { id: string; code: string; title: string };
  status: { code: string; title: string; color_token: string; is_terminal: boolean; is_cancelled: boolean };
  stages: { code: string; title: string; current: boolean }[];
  due_at: string;
  /** Минут до срока; отрицательное — просрочен на столько; `null` у закрытого. */
  due_in_minutes: number | null;
  lines: { title: string; quantity: number }[];
  lines_more: number;
  total: number | null;
  currency: string;
  assignee: { id: string; name: string } | null;
  next_statuses: { code: string; title: string }[];
  rights: { move: boolean; assign: boolean; [key: string]: boolean };
}

export interface RoomCardData {
  type: 'room';
  id: string;
  number: string;
  floor: string | null;
  building: string | null;
  category: string | null;
  is_active: boolean;
  out_of_service: boolean;
  housekeeping: string;
  /** Живая гостевая сессия в номере — без данных гостя. Не «занят»: занятости нет до PMS. */
  guest_online: boolean;
  open_orders: number;
  open_tasks: number;
  /** `null` — номер не управляется. */
  control: 'online' | 'offline' | 'no_node' | null;
}

export interface VenueCardData {
  type: 'venue';
  id: string;
  point_code: string;
  title: string;
  kind: string;
  is_active: boolean;
  image: string | null;
  items: number;
  schedule: { state: 'open' | 'closed'; until: string | null; opens_at: string | null; available_at: string | null } | null;
  in_work: number;
  overdue: number;
}

export type CardData = OrderCardData | RoomCardData | VenueCardData;

export function fetchCard(type: EntityType, key: string): Promise<CardData> {
  return api.get<CardData>(`/cards/${type}/${encodeURIComponent(key)}`);
}

/** Ключ кэша. Сокет и действия сбрасывают все карточки разом — `cardKeys.all`. */
export const cardKeys = {
  all: ['card'] as const,
  one: (type: EntityType, key: string) => ['card', type, key] as const,
};

/** Кэш карточки — 60 с: повторное наведение — без запроса (РАЗВЕДКА-59, Б3). */
export const CARD_STALE_MS = 60_000;
