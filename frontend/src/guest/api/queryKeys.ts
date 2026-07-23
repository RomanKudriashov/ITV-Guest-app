/** Query keys for the guest storefront. Namespaced away from the CMS keys. */
export const guestKeys = {
  all: ['guest'] as const,
  session: ['guest', 'session'] as const,
  catalog: (type: string, language: string, point?: string) =>
    ['guest', 'catalog', type, language, point ?? null] as const,
  venues: (group: string, language: string) => ['guest', 'venues', group, language] as const,
  item: (id: string, language: string) => ['guest', 'item', id, language] as const,
  locations: (language: string) => ['guest', 'locations', language] as const,
  slots: (itemId: string, date: string, language: string) =>
    ['guest', 'slots', itemId, date, language] as const,
  orders: (language: string) => ['guest', 'orders', language] as const,
  /**
   * Live orders for the home strip. Nested UNDER `['guest','orders']` on purpose:
   * the existing order WS invalidates that prefix on every snapshot, so this list
   * refetches without a second channel.
   */
  activeOrders: (language: string) => ['guest', 'orders', 'active', language] as const,
  order: (id: string) => ['guest', 'order', id] as const,
  /** Server cart pricing, keyed on the quote-relevant body (lines + location + tip). */
  cartQuote: (signature: string, language: string) =>
    ['guest', 'cartQuote', signature, language] as const,
  home: (language: string) => ['guest', 'home', language] as const,
  /** Single thread per guest — a stable key the WS snapshot overwrites. */
  chat: ['guest', 'chat'] as const,
  review: (orderId: string) => ['guest', 'review', orderId] as const,
};
