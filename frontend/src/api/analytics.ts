/** One function per endpoint of `docs/analytics-api-contract.md`. */
import { api } from './client';
import type {
  AnalyticsQuery,
  AnalyticsScope,
  BreakdownResponse,
  DrilldownResponse,
  ExportFormat,
  ExportJob,
  OperationsResponse,
  ReviewsResponse,
  SummaryResponse,
  TimeseriesResponse,
  TrafficResponse,
} from './analyticsTypes';

const BASE = '/cms/analytics';

/** `AnalyticsQuery` is already the wire shape — pass it straight to the client. */
type Query = Record<string, string | number | boolean | undefined | null>;

function toQuery(params: AnalyticsQuery): Query {
  return params as Query;
}

export function fetchSummary(params: AnalyticsQuery): Promise<SummaryResponse> {
  return api.get<SummaryResponse>(`${BASE}/summary`, { query: toQuery(params) });
}

export function fetchTimeseries(params: AnalyticsQuery): Promise<TimeseriesResponse> {
  return api.get<TimeseriesResponse>(`${BASE}/timeseries`, { query: toQuery(params) });
}

export function fetchBreakdown(params: AnalyticsQuery): Promise<BreakdownResponse> {
  return api.get<BreakdownResponse>(`${BASE}/breakdown`, { query: toQuery(params) });
}

export function fetchOperations(params: AnalyticsQuery): Promise<OperationsResponse> {
  return api.get<OperationsResponse>(`${BASE}/operations`, { query: toQuery(params) });
}

export function fetchTraffic(params: AnalyticsQuery): Promise<TrafficResponse> {
  return api.get<TrafficResponse>(`${BASE}/traffic`, { query: toQuery(params) });
}

export function fetchReviews(params: AnalyticsQuery): Promise<ReviewsResponse> {
  return api.get<ReviewsResponse>(`${BASE}/reviews`, { query: toQuery(params) });
}

export function fetchDrilldown(params: AnalyticsQuery): Promise<DrilldownResponse> {
  return api.get<DrilldownResponse>(`${BASE}/drilldown`, { query: toQuery(params) });
}

/** Permission scope — the front-end reads this instead of guessing. */
export function fetchScope(): Promise<AnalyticsScope> {
  return api.get<AnalyticsScope>(`${BASE}/scope`);
}

/** Queue a heavy export of the current slice; returns `{id, status}`. */
export function requestExport(
  format: ExportFormat,
  params: AnalyticsQuery,
): Promise<ExportJob> {
  return api.post<ExportJob>(`${BASE}/export`, { format, params });
}

/** Poll a queued export until it reports `ready` (or `failed`). */
export function fetchExportJob(id: string): Promise<ExportJob> {
  return api.get<ExportJob>(`${BASE}/export/${id}`);
}
