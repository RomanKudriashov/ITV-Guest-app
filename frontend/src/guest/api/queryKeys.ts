/** Query keys for the guest storefront. Namespaced away from the CMS keys. */
export const guestKeys = {
  all: ['guest'] as const,
  session: ['guest', 'session'] as const,
  menu: (language: string) => ['guest', 'menu', language] as const,
  item: (id: string, language: string) => ['guest', 'item', id, language] as const,
  locations: (language: string) => ['guest', 'locations', language] as const,
  orders: (language: string) => ['guest', 'orders', language] as const,
  order: (id: string) => ['guest', 'order', id] as const,
};
