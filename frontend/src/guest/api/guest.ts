/** Guest storefront endpoints — one function per route in the contract. */

import type { OfferingType } from '@/offerings/behaviour';
import { ApiError } from '@/api/client';
import { guestApi, guestTokenStorage } from './client';
import type {
  ChatSnapshot,
  CreateOrderPayload,
  CreateSessionPayload,
  GuestCatalog,
  GuestHome,
  GuestLocations,
  GuestOrder,
  GuestOrderList,
  GuestReview,
  GuestSession,
  GuestSessionCreated,
  GuestSlotAvailability,
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
 * Availability of a `slot` offering for one day. There is no second "booking"
 * catalog — the guest reaches here after opening a slot item, and the booking
 * it makes goes through the very same `createOrder` below.
 */
export function fetchSlots(
  itemId: string,
  date: string,
  language?: string,
): Promise<GuestSlotAvailability> {
  return guestApi.get<GuestSlotAvailability>('/guest/slots', {
    query: { item_id: itemId, date, lang: language },
  });
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

/**
 * The home screen, assembled by the server from whatever the hotel actually
 * offers (contract §1). The storefront draws only the sections it receives, in
 * the given order — there is no hard-coded list of tiles.
 */
export function fetchHome(language?: string): Promise<GuestHome> {
  return guestApi.get<GuestHome>('/guest/home', { query: { lang: language } });
}

/** The guest's thread + messages. Creates the thread on first call (contract §3). */
export function fetchChat(language?: string): Promise<ChatSnapshot> {
  return guestApi.get<ChatSnapshot>('/guest/chat', { query: { lang: language } });
}

/** Send a message; the response is the fresh full snapshot, not a delta. */
export function sendChatMessage(body: string, language?: string): Promise<ChatSnapshot> {
  return guestApi.post<ChatSnapshot>('/guest/chat', { body }, { query: { lang: language } });
}

/** Mark staff messages as read. */
export function markChatRead(language?: string): Promise<ChatSnapshot> {
  return guestApi.post<ChatSnapshot>('/guest/chat/read', {}, { query: { lang: language } });
}

/**
 * The review left for an order, or `null` when none exists yet. A 404 is a
 * scenario ("not reviewed"), not an error, so it resolves to `null`.
 */
export async function fetchReview(orderId: string, language?: string): Promise<GuestReview | null> {
  try {
    return await guestApi.get<GuestReview>(`/guest/order/${orderId}/review`, {
      query: { lang: language },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Leave a review. One per order: a repeat comes back as `409 review_exists`, a
 * review before completion as `422 review_not_allowed` — both surfaced verbatim.
 */
export function submitReview(
  orderId: string,
  rating: number,
  comment: string,
  language?: string,
): Promise<GuestReview> {
  return guestApi.post<GuestReview>(
    `/guest/order/${orderId}/review`,
    { rating, comment },
    { query: { lang: language } },
  );
}

export function hasGuestToken(): boolean {
  return Boolean(guestTokenStorage.get());
}
