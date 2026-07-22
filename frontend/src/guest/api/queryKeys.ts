/** Query keys for the guest storefront. Namespaced away from the CMS keys. */
export const guestKeys = {
  all: ['guest'] as const,
  session: ['guest', 'session'] as const,
  catalog: (type: string, language: string) => ['guest', 'catalog', type, language] as const,
  item: (id: string, language: string) => ['guest', 'item', id, language] as const,
  locations: (language: string) => ['guest', 'locations', language] as const,
  slots: (itemId: string, date: string, language: string) =>
    ['guest', 'slots', itemId, date, language] as const,
  orders: (language: string) => ['guest', 'orders', language] as const,
  order: (id: string) => ['guest', 'order', id] as const,
  home: (language: string) => ['guest', 'home', language] as const,
  /** Single thread per guest — a stable key the WS snapshot overwrites. */
  chat: ['guest', 'chat'] as const,
  review: (orderId: string) => ['guest', 'review', orderId] as const,
};
