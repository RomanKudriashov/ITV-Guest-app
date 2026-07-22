/**
 * Dimension registry for the analytics filters and breakdowns.
 *
 * A dimension is a DATA value, never a code branch: nothing here compares an
 * `offering_type` string to fork behaviour — the values below are just the
 * registry entries the backend aggregates by, surfaced as filter options.
 */
import type { AnalyticsQuery, Dimension } from '@/api/analyticsTypes';

/** Contract query-param name a dimension filter maps onto. */
export const DIMENSION_PARAM: Record<Dimension, keyof AnalyticsQuery> = {
  type: 'type',
  category: 'category_id',
  item: 'item_id',
  point: 'point_id',
  location: 'location_id',
  entry_method: 'entry_method',
  device: 'device',
  language: 'language',
  floor: 'floor',
  room: 'room',
  status: 'status',
};

/** Order the filter controls appear in the panel. */
export const FILTER_DIMENSIONS: Dimension[] = [
  'type',
  'category',
  'item',
  'point',
  'location',
  'entry_method',
  'device',
  'language',
  'floor',
  'room',
  'status',
];

/**
 * Stable registry values (not code forks). Data-driven dimensions
 * (category/item/location/point/floor/room/status) get their options from
 * `/analytics/scope` instead and are omitted here.
 */
export const STATIC_DIMENSION_VALUES: Partial<Record<Dimension, string[]>> = {
  type: ['product', 'service_request', 'info', 'slot'],
  entry_method: ['anonymous', 'room_scanned', 'pms_verified', 'staff_verified'],
  device: ['mobile', 'tablet', 'desktop', 'unknown'],
  language: ['ru', 'en', 'ar', 'zh'],
};

/** Dimensions offered as a `dimension=` breakdown axis in the Sales tab. */
export const BREAKDOWN_DIMENSIONS: Dimension[] = [
  'type',
  'category',
  'item',
  'point',
  'location',
  'entry_method',
  'device',
  'language',
];

/**
 * Drill path from broad to concrete: choosing a row narrows the filter and
 * advances to the next axis, ending at the concrete order list. Swod → type →
 * category → item → orders.
 */
export const DRILL_CHAIN: Dimension[] = ['type', 'category', 'item'];

/** The next axis to break down by after drilling into `dimension`, if any. */
export function nextDrillDimension(dimension: Dimension): Dimension | null {
  const index = DRILL_CHAIN.indexOf(dimension);
  if (index === -1 || index + 1 >= DRILL_CHAIN.length) return null;
  return DRILL_CHAIN[index + 1];
}
