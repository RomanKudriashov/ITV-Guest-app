export const queryKeys = {
  bootstrap: ['cms', 'bootstrap'] as const,
  categories: ['cms', 'categories'] as const,
  category: (id: string) => ['cms', 'categories', id] as const,
  items: (categoryId: string | undefined, search?: string) =>
    ['cms', 'items', categoryId ?? 'all', search ?? ''] as const,
  item: (id: string) => ['cms', 'items', 'detail', id] as const,
  schedules: ['cms', 'schedules'] as const,
  notificationChannels: ['cms', 'notification-channels'] as const,
  escalationRules: ['cms', 'escalation-rules'] as const,
  /** The journal is polled while the tab is open, hence the filters in the key. */
  notificationLog: (status: string, orderId: string, limit: number) =>
    ['cms', 'notification-log', status || 'all', orderId || 'all', limit] as const,
  staffUsers: ['cms', 'staff-users'] as const,
};
