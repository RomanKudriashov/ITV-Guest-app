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
  homeSettings: ['cms', 'home-settings'] as const,
  searchSettings: ['cms', 'search-settings'] as const,
  showcase: ['cms', 'showcase'] as const,
  /* ── Управление номером (модуль room_control) ───────────────────────── */
  /*
    КЛЮЧИ УПРАВЛЕНИЯ НОМЕРОМ ВКЛЮЧАЮТ БАЗУ API.

    Одни и те же экраны обслуживают CMS отеля и консоль платформы, а в консоли
    база зависит от ОТКРЫТОГО отеля. Без базы в ключе кэш отдал бы типы одного
    отеля под именем другого — переключился на соседний, а на экране прежние
    зоны, и правка ушла бы не туда.
  */
  grmsCatalog: (base: string) => [base, 'grms', 'catalog'] as const,
  grmsTypes: (base: string) => [base, 'grms', 'types'] as const,
  grmsStatus: (base: string, code: string) => [base, 'grms', 'types', code, 'status'] as const,
  grmsVersions: (base: string, code: string) => [base, 'grms', 'types', code, 'versions'] as const,
  grmsPlan: (base: string, code: string) => [base, 'grms', 'types', code, 'plan'] as const,
  grmsAccess: ['cms', 'grms', 'access'] as const,
  grmsDiagnostics: (base: string, slice: string) =>
    [base, 'grms', 'diagnostics', slice] as const,
  grmsDiagnosticsLink: (base: string) => [base, 'grms', 'diagnostics', 'link'] as const,
  grmsDiagnosticsFilters: (base: string) => [base, 'grms', 'diagnostics', 'filters'] as const,
  allergens: ['cms', 'allergens'] as const,
  markers: ['cms', 'markers'] as const,
};
