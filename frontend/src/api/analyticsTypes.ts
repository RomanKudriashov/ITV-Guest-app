/**
 * Analytics API types — mirror of `docs/analytics-api-contract.md`.
 *
 * The dashboard reads pre-aggregated rollups only; every endpoint under
 * `/api/cms/analytics` accepts the common query params (period, compare,
 * dimension filters) described in the contract. Types are built to the
 * CONTRACT — the backend may 404 until it lands, which the UI tolerates.
 */

/** A period preset; `custom` means an explicit `date_from`/`date_to`. */
export type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

/** Top-level dashboard views. */
export type AnalyticsTab = 'sales' | 'operations' | 'traffic' | 'reviews';

/** Timeseries buckets. */
export type Granularity = 'hour' | 'day' | 'week';

export type SortOrder = 'asc' | 'desc';

/**
 * Dimensions a slice can be filtered/broken down by. These are DATA values
 * (registry entries), never code branches — the UI merely passes them through.
 */
export type Dimension =
  | 'type'
  | 'category'
  | 'item'
  | 'point'
  | 'location'
  | 'entry_method'
  | 'device'
  | 'language'
  | 'floor'
  | 'room'
  | 'status';

/** Filter values keyed by dimension. Empty/undefined means "no filter". */
export type DimensionFilters = Partial<Record<Dimension, string>>;

/** Serialized query params sent to every analytics endpoint. */
export interface AnalyticsQuery {
  preset?: PeriodPreset;
  date_from?: string;
  date_to?: string;
  compare?: 'previous';
  // Dimension filters (contract param names).
  type?: string;
  category_id?: string;
  item_id?: string;
  point_id?: string;
  location_id?: string;
  entry_method?: string;
  device?: string;
  language?: string;
  floor?: string;
  room?: string;
  status?: string;
  // Per-endpoint extras.
  dimension?: string;
  granularity?: Granularity;
  sort?: string;
  order?: SortOrder;
  group?: string;
}

/** All headline metrics returned by `/analytics/summary`. */
export interface SummaryMetrics {
  orders: number;
  /** Выручка по позициям (subtotal). Полная сумма — `gross_minor`. */
  revenue_minor: number;
  /** Разложение выручки (A3+ шаг 7): позиции + начисления. */
  gross_minor: number;
  service_fee_minor: number;
  delivery_minor: number;
  tax_minor: number;
  tip_minor: number;
  avg_check_minor: number;
  items_per_order: number;
  completed_rate: number;
  cancel_rate: number;
  avg_reaction_seconds: number;
  avg_fulfil_seconds: number;
  avg_rating: number;
  low_review_rate: number;
  sessions: number;
  conversion: number;
}

export interface AnalyticsPeriod {
  from: string;
  to: string;
  tz: string;
}

export interface SummaryResponse {
  period: AnalyticsPeriod;
  current: SummaryMetrics;
  previous?: SummaryMetrics;
  /** Fractions of change per metric, e.g. `0.12` = +12 %. */
  delta?: Partial<Record<keyof SummaryMetrics, number>>;
}

/** A single timeseries bucket. Metric fields are optional per granularity. */
export interface TimeseriesPoint {
  bucket: string;
  orders: number;
  revenue_minor: number;
  sessions?: number;
  cancelled?: number;
}

export interface TimeseriesResponse {
  granularity: Granularity;
  points: TimeseriesPoint[];
}

/** One breakdown row (a value of the chosen dimension). */
export interface BreakdownRow {
  key: string;
  label: string;
  orders: number;
  quantity?: number;
  revenue_minor: number;
  /** Share of the total, 0..1. */
  share: number;
}

export interface BreakdownResponse {
  dimension: string;
  rows: BreakdownRow[];
}

/** A concrete order surfaced by drill-down. */
export interface DrilldownOrder {
  id: string;
  number: string;
  type: string;
  point: string;
  status: string;
  total_minor: number;
  created_at: string;
  room: string | null;
  rating: number | null;
}

export interface DrilldownResponse {
  orders: DrilldownOrder[];
  total: number;
}

/** Per-group operations row (reaction/fulfilment/cancellations/escalations). */
export interface OperationsRow {
  key: string;
  label: string;
  orders: number;
  avg_reaction_seconds: number;
  avg_fulfil_seconds: number;
  cancelled_count: number;
  cancel_rate: number;
  off_hours_count: number;
  escalations: number;
}

export interface OperationsResponse {
  avg_reaction_seconds: number;
  avg_fulfil_seconds: number;
  cancel_rate: number;
  off_hours_rate: number;
  escalations: number;
  rows: OperationsRow[];
}

export interface TrafficResponse {
  sessions: number;
  conversion: number;
  by_entry_method: BreakdownRow[];
  by_device: BreakdownRow[];
  by_language: BreakdownRow[];
}

export interface ReviewsTrendPoint {
  bucket: string;
  avg_rating: number;
  reviews_count: number;
  low_count: number;
}

export interface ReviewsResponse {
  avg_rating: number;
  low_review_rate: number;
  reviews_count: number;
  trend: ReviewsTrendPoint[];
  by_point: BreakdownRow[];
}

export interface ScopePoint {
  id: string;
  title: string;
}

export interface ScopeHotel {
  id: string;
  name: string;
}

export interface ScopeDimensionValue {
  key: string;
  label: string;
}

/**
 * What the current user may see. The front-end never guesses the permission
 * scope: point-scoped staff only get their points, so their point filter is
 * pinned/disabled accordingly.
 */
export interface AnalyticsScope {
  is_platform_admin: boolean;
  is_hotel_admin: boolean;
  /** Points the user may see. A point-scoped user gets exactly their points. */
  points: ScopePoint[];
  /** Cross-hotel comparison is a platform-admin-only affordance. */
  hotels?: ScopeHotel[];
  /**
   * Known values for data-driven dimensions (category/item/location/floor/
   * room/status). Absent dimensions fall back to whatever the slice reveals.
   */
  dimensions?: Partial<Record<Dimension, ScopeDimensionValue[]>>;
}

export type ExportFormat = 'csv' | 'xlsx';
export type ExportStatus = 'pending' | 'running' | 'ready' | 'failed';

export interface ExportJob {
  id: string;
  status: ExportStatus;
  format?: ExportFormat;
  /** Present when `status === 'ready'`. */
  file?: string;
  row_count?: number;
  error?: string;
}
