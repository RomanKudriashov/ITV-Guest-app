import { api } from '@/api/client';

export interface ReviewReply {
  text: string;
  at: string;
  /** Кто ответил. */
  by: string;
  /** Ушёл ли ответ гостю в чат. `false` — гость уже уехал, ответ только хранится. */
  delivered: boolean;
}

export interface CmsReview {
  id: string;
  order_id: string;
  order_number: number;
  rating: number;
  comment: string;
  created_at: string;
  room: string;
  /** Заведения заказа: у заказа из двух частей — обе. */
  points: { id: string; title: string }[];
  is_low: boolean;
  /** Дойдёт ли ответ сейчас — экран говорит это ДО ответа. */
  guest_reachable: boolean;
  reply: ReviewReply | null;
}

export interface ReviewsPage {
  items: CmsReview[];
  total: number;
  limit: number;
  offset: number;
  truncated: boolean;
}

export interface ReviewsSummary {
  count: number;
  avg_rating: number | null;
  low: number;
  low_rate: number | null;
  /** Порог низкой оценки отеля: «≤ порога» — низкая. */
  low_threshold: number;
  trend: { day: string; count: number; avg_rating: number; low: number }[];
}

export interface ReviewsFilters {
  point_id?: string;
  rating?: string;
  date_from?: string;
  date_to?: string;
}

function toQuery(filters: ReviewsFilters, extra: Record<string, string | number> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return query.toString();
}

/** Фильтры уходят на сервер целиком: отсев страницы врал бы счётчиком. */
export function fetchReviewsPage(filters: ReviewsFilters, offset = 0, limit = 25): Promise<ReviewsPage> {
  return api.get<ReviewsPage>(`/cms/reviews?${toQuery(filters, { offset, limit })}`);
}

export function fetchReviewsSummary(filters: ReviewsFilters): Promise<ReviewsSummary> {
  return api.get<ReviewsSummary>(`/cms/reviews/summary?${toQuery(filters)}`);
}

export function replyToReview(reviewId: string, text: string): Promise<CmsReview> {
  return api.post<CmsReview>(`/cms/reviews/${reviewId}/reply`, { text });
}
