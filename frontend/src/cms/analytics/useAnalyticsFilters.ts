import { useCallback, useMemo, useState } from 'react';

import type {
  AnalyticsQuery,
  Dimension,
  DimensionFilters,
  PeriodPreset,
} from '@/api/analyticsTypes';
import { DIMENSION_PARAM } from './dimensions';

/**
 * The whole dashboard reads and writes ONE filter object. Every query on the
 * page derives its params from `toQuery(...)`, so a preset change, a compare
 * toggle or a drill-down all funnel through the same source of truth — no
 * component keeps its own copy of "the current slice".
 */
export interface AnalyticsFilterState {
  preset: PeriodPreset;
  /** Used only when `preset === 'custom'` (ISO `YYYY-MM-DD`, hotel-local). */
  dateFrom: string;
  dateTo: string;
  compare: boolean;
  dimensions: DimensionFilters;
}

const INITIAL_STATE: AnalyticsFilterState = {
  preset: 'week',
  dateFrom: '',
  dateTo: '',
  compare: false,
  dimensions: {},
};

export interface UseAnalyticsFilters {
  filters: AnalyticsFilterState;
  setPreset: (preset: PeriodPreset) => void;
  setCustomRange: (from: string, to: string) => void;
  toggleCompare: (value?: boolean) => void;
  /** Set (or clear, with `null`) a single dimension filter. */
  setDimension: (dimension: Dimension, value: string | null) => void;
  clearDimensions: () => void;
  /** Build the wire query for an endpoint, merged with per-call extras. */
  toQuery: (extra?: Partial<AnalyticsQuery>) => AnalyticsQuery;
  /** Stable string of the current slice — used as a react-query key segment. */
  sliceKey: (extra?: Partial<AnalyticsQuery>) => string;
  activeFilterCount: number;
}

export function useAnalyticsFilters(): UseAnalyticsFilters {
  const [filters, setFilters] = useState<AnalyticsFilterState>(INITIAL_STATE);

  const setPreset = useCallback((preset: PeriodPreset) => {
    setFilters((prev) => ({ ...prev, preset }));
  }, []);

  const setCustomRange = useCallback((from: string, to: string) => {
    setFilters((prev) => ({ ...prev, preset: 'custom', dateFrom: from, dateTo: to }));
  }, []);

  const toggleCompare = useCallback((value?: boolean) => {
    setFilters((prev) => ({ ...prev, compare: value ?? !prev.compare }));
  }, []);

  const setDimension = useCallback((dimension: Dimension, value: string | null) => {
    setFilters((prev) => {
      const next = { ...prev.dimensions };
      if (value === null || value === '') delete next[dimension];
      else next[dimension] = value;
      return { ...prev, dimensions: next };
    });
  }, []);

  const clearDimensions = useCallback(() => {
    setFilters((prev) => ({ ...prev, dimensions: {} }));
  }, []);

  const toQuery = useCallback(
    (extra?: Partial<AnalyticsQuery>): AnalyticsQuery => {
      const query: AnalyticsQuery = {};

      if (filters.preset === 'custom') {
        if (filters.dateFrom) query.date_from = filters.dateFrom;
        if (filters.dateTo) query.date_to = filters.dateTo;
      } else {
        query.preset = filters.preset;
      }

      if (filters.compare) query.compare = 'previous';

      for (const [dimension, value] of Object.entries(filters.dimensions)) {
        if (!value) continue;
        const param = DIMENSION_PARAM[dimension as Dimension];
        // Every dimension maps to a plain string-valued filter param.
        (query as Record<string, string>)[param] = value;
      }

      return { ...query, ...extra };
    },
    [filters],
  );

  const sliceKey = useCallback(
    (extra?: Partial<AnalyticsQuery>) => stableStringify(toQuery(extra)),
    [toQuery],
  );

  const activeFilterCount = useMemo(
    () => Object.values(filters.dimensions).filter(Boolean).length,
    [filters.dimensions],
  );

  return {
    filters,
    setPreset,
    setCustomRange,
    toggleCompare,
    setDimension,
    clearDimensions,
    toQuery,
    sliceKey,
    activeFilterCount,
  };
}

/** Deterministic JSON (sorted keys) so equal slices produce equal query keys. */
function stableStringify(value: AnalyticsQuery): string {
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}
