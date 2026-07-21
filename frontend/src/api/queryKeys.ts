export const queryKeys = {
  bootstrap: ['cms', 'bootstrap'] as const,
  categories: ['cms', 'categories'] as const,
  category: (id: string) => ['cms', 'categories', id] as const,
  items: (categoryId: string | undefined, search?: string) =>
    ['cms', 'items', categoryId ?? 'all', search ?? ''] as const,
  item: (id: string) => ['cms', 'items', 'detail', id] as const,
  schedules: ['cms', 'schedules'] as const,
};
