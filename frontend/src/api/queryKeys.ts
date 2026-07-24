export const queryKeys = {
  bootstrap: ['cms', 'bootstrap'] as const,
  categories: ['cms', 'categories'] as const,
  category: (id: string) => ['cms', 'categories', id] as const,
  items: (categoryId: string | undefined, search?: string) =>
    ['cms', 'items', categoryId ?? 'all', search ?? ''] as const,
  item: (id: string) => ['cms', 'items', 'detail', id] as const,
  slotConfig: (id: string) => ['cms', 'items', 'slot-config', id] as const,
  schedules: ['cms', 'schedules'] as const,
  notificationChannels: ['cms', 'notification-channels'] as const,
  escalationRules: ['cms', 'escalation-rules'] as const,
  /** The journal is polled while the tab is open, hence the filters in the key. */
  notificationLog: (status: string, orderId: string, limit: number) =>
    ['cms', 'notification-log', status || 'all', orderId || 'all', limit] as const,
  staffUsers: ['cms', 'staff-users'] as const,
  /* ── Hotel admin ────────────────────────────────────────────────────── */
  rooms: ['cms', 'rooms'] as const,
  locations: ['cms', 'locations'] as const,
  locationMatrix: ['cms', 'locations', 'matrix'] as const,
  departments: ['cms', 'departments'] as const,
  staff: ['cms', 'staff'] as const,
  brand: ['cms', 'brand'] as const,
  brandPresets: ['cms', 'brand', 'presets'] as const,
  brandAbstractions: ['cms', 'brand', 'abstractions'] as const,
  brandFonts: ['cms', 'brand', 'fonts'] as const,
  /* ── Analytics ──────────────────────────────────────────────────────── */
  analyticsScope: ['cms', 'analytics', 'scope'] as const,
  // The serialized slice is folded into each key so a filter change refetches.
  analyticsSummary: (slice: string) => ['cms', 'analytics', 'summary', slice] as const,
  analyticsTimeseries: (slice: string) => ['cms', 'analytics', 'timeseries', slice] as const,
  analyticsBreakdown: (slice: string) => ['cms', 'analytics', 'breakdown', slice] as const,
  analyticsOperations: (slice: string) => ['cms', 'analytics', 'operations', slice] as const,
  analyticsTraffic: (slice: string) => ['cms', 'analytics', 'traffic', slice] as const,
  analyticsReviews: (slice: string) => ['cms', 'analytics', 'reviews', slice] as const,
  analyticsDrilldown: (slice: string) => ['cms', 'analytics', 'drilldown', slice] as const,
  analyticsExport: (id: string) => ['cms', 'analytics', 'export', id] as const,
  /* ── Commerce & marketing ───────────────────────────────────────────── */
  commerceSettings: ['cms', 'commerce-settings'] as const,
  badges: ['cms', 'badges'] as const,
  quickActions: ['cms', 'quick-actions'] as const,
  showcase: ['cms', 'showcase'] as const,
  allergens: ['cms', 'allergens'] as const,
  markers: ['cms', 'markers'] as const,
};
