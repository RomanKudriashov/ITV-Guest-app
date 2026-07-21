/** Guest storefront endpoints — one function per route in the contract. */

import type { OfferingType } from '@/offerings/behaviour';
import { guestApi, guestTokenStorage } from './client';
import type {
  CreateOrderPayload,
  CreateSessionPayload,
  GuestCatalog,
  GuestLocations,
  GuestOrder,
  GuestOrderList,
  GuestSession,
  GuestSessionCreated,
  ItemDetail,
} from './types';

export function createSession(payload: CreateSessionPayload): Promise<GuestSessionCreated> {
  // No token yet, and a 404 (`room_not_found`) is a scenario branch, not a bounce.
  return guestApi.post<GuestSessionCreated>('/guest/session', payload, {
    skipAuthRedirect: true,
  });
}

export function fetchSession(): Promise<GuestSession> {
  return guestApi.get<GuestSession>('/guest/session', { skipAuthRedirect: true });
}

/**
 * One catalog endpoint for every offering type (contract §2). The food menu is
 * `type=product`; services are `type=service_request`. There is deliberately no
 * second "services" endpoint and no branch here — only a query parameter.
 */
export function fetchCatalog(type: OfferingType, language?: string): Promise<GuestCatalog> {
  return guestApi.get<GuestCatalog>('/guest/catalog', {
    query: { type, include_unavailable: true, lang: language },
  });
}

export function fetchItem(itemId: string, language?: string): Promise<ItemDetail> {
  return guestApi.get<ItemDetail>(`/guest/item/${itemId}`, { query: { lang: language } });
}

export function fetchLocations(language?: string): Promise<GuestLocations> {
  return guestApi.get<GuestLocations>('/guest/locations', { query: { lang: language } });
}

/**
 * `Idempotency-Key` is mandatory. The caller owns the key and MUST reuse the very
 * same one when retrying the same attempt — that is what stops a flaky mobile
 * network from producing two identical orders.
 */
export function createOrder(
  payload: CreateOrderPayload,
  idempotencyKey: string,
  language?: string,
): Promise<GuestOrder> {
  return guestApi.post<GuestOrder>('/guest/order', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
    query: { lang: language },
  });
}

export function fetchOrders(language?: string): Promise<GuestOrderList> {
  return guestApi.get<GuestOrderList>('/guest/orders', { query: { lang: language } });
}

export function fetchOrder(orderId: string, language?: string): Promise<GuestOrder> {
  return guestApi.get<GuestOrder>(`/guest/order/${orderId}`, { query: { lang: language } });
}

export function cancelOrder(
  orderId: string,
  reason?: string,
  language?: string,
): Promise<GuestOrder> {
  return guestApi.post<GuestOrder>(
    `/guest/order/${orderId}/cancel`,
    { reason: reason ?? '' },
    { query: { lang: language } },
  );
}

export function hasGuestToken(): boolean {
  return Boolean(guestTokenStorage.get());
}
