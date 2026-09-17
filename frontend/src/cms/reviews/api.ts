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
  triage: TriageStatus;
}

export type TriageStatus = 'new' | 'in_progress' | 'closed';

export interface TriageStep {
  from: TriageStatus | '';
  to: TriageStatus;
  comment: string;
  by: string;
  at: string;
}

export interface ReviewsPage {
  items: CmsReview[];
  total: number;
  limit: number;
  offset: number;
  truncated: boolean;
}

export interface ReviewsSummary {
  /** Ждут разбора (новые и разбираемые) — без учёта фильтра статуса. */
  awaiting: number;
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
  /** `open` — новые и разбираемые вместе. */
  triage?: string;
}

function toQuery(filters: ReviewsFilters, extra: Record<string, string | number> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return query.toString();
}

/** Фильтры уходят на сервер целиком: отсев страницы врал бы счётчиком. */
export function fetchReviewsPage(
  filters: ReviewsFilters,
  offset = 0,
  limit = 25,
): Promise<ReviewsPage> {
  return api.get<ReviewsPage>(`/cms/reviews?${toQuery(filters, { offset, limit })}`);
}

export function fetchReviewsSummary(filters: ReviewsFilters): Promise<ReviewsSummary> {
  return api.get<ReviewsSummary>(`/cms/reviews/summary?${toQuery(filters)}`);
}

export function replyToReview(reviewId: string, text: string): Promise<CmsReview> {
  return api.post<CmsReview>(`/cms/reviews/${reviewId}/reply`, { text });
}

export interface InvestigationPart {
  order_id: string;
  number: number;
  point: { id: string; title: string };
  status: string;
  delivery_mode: string;
  location: string;
  /** Кто вёл: взявший заказ, иначе первый, кто двигал статус. */
  assignee: string | null;
  created_at: string;
  accepted_at: string | null;
  closed_at: string | null;
  reopened: boolean;
  reaction_minutes: number | null;
  work_minutes: number | null;
  total_minutes: number | null;
  /** Порог просрочки снимком на момент заказа. */
  sla_minutes: number | null;
  overdue_minutes: number;
  was_overdue: boolean;
  escalations: { step: number; at: string; status: string; target: string }[];
  history: {
    title: string;
    at: string;
    by: string | null;
    actor_type: string;
    comment: string;
  }[];
}

export interface ReviewInvestigation {
  review: CmsReview;
  triage: TriageStep[];
  order: {
    id: string;
    number: number;
    room: string;
    created_at: string;
    closed_at: string | null;
    total_minutes: number | null;
    total: number | null;
    currency: string;
    lines: { title: string; quantity: number }[];
    comment: string;
  };
  parts: InvestigationPart[];
  chat: { author_type: 'guest' | 'staff'; author: string; body: string; at: string }[];
  chat_window: { from: string; to: string };
}

export function fetchInvestigation(reviewId: string): Promise<ReviewInvestigation> {
  return api.get<ReviewInvestigation>(`/cms/reviews/${reviewId}`);
}

export function triageReview(
  reviewId: string,
  status: TriageStatus,
  comment: string,
): Promise<CmsReview> {
  return api.post<CmsReview>(`/cms/reviews/${reviewId}/triage`, { status, comment });
}
