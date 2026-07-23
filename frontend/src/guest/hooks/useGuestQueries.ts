import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { OfferingType } from '@/offerings/behaviour';
import {
  fetchActiveOrders,
  fetchCatalog,
  fetchChat,
  fetchHome,
  fetchItem,
  fetchLocations,
  fetchOrder,
  fetchOrders,
  fetchReview,
  fetchSlots,
  quoteCart,
} from '../api/guest';
import { guestKeys } from '../api/queryKeys';
import { useGuestSession } from '../session/GuestSessionProvider';
import type {
  CartQuote,
  ChatSnapshot,
  CreateOrderPayload,
  GuestActiveOrders,
  GuestCatalog,
  GuestHome,
  GuestLocations,
  GuestOrder,
  GuestOrderList,
  GuestReview,
  GuestSlotAvailability,
  ItemDetail,
} from '../api/types';

/** Interface language, normalized — texts arrive already localized from the API. */
export function useGuestLanguage(): string {
  const { i18n } = useTranslation();
  return (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];
}

/**
 * The catalog of one offering type. Food and services differ by a query
 * parameter and a cache key — not by a hook, a page or a code path.
 */
export function useGuestCatalog(type: OfferingType, enabled = true) {
  const language = useGuestLanguage();
  const { isReady } = useGuestSession();
  return useQuery<GuestCatalog>({
    queryKey: guestKeys.catalog(type, language),
    queryFn: () => fetchCatalog(type, language),
    enabled: isReady && enabled,
    staleTime: 60_000,
  });
}

export function useGuestItem(itemId: string | null, initialData?: ItemDetail) {
  const language = useGuestLanguage();
  const { isReady } = useGuestSession();
  return useQuery<ItemDetail>({
    queryKey: guestKeys.item(itemId ?? 'none', language),
    queryFn: () => fetchItem(itemId as string, language),
    enabled: isReady && Boolean(itemId),
    initialData,
    staleTime: 60_000,
  });
}

/**
 * Locations are only ever asked for when the item's `location_mode` is
 * `delivery` — hence the `enabled` switch: a taxi request must not even fetch
 * the list it will never show.
 */
export function useGuestLocations(enabled = true) {
  const language = useGuestLanguage();
  const { isReady } = useGuestSession();
  return useQuery<GuestLocations>({
    queryKey: guestKeys.locations(language),
    queryFn: () => fetchLocations(language),
    enabled: isReady && enabled,
    staleTime: 5 * 60_000,
  });
}

/**
 * Availability of one `slot` offering on one day. Short-lived on purpose: a
 * slot can be taken by another guest at any moment, so the picker refetches
 * often and never trusts a stale grid.
 */
export function useGuestSlots(itemId: string | null, date: string, enabled = true) {
  const language = useGuestLanguage();
  const { isReady } = useGuestSession();
  return useQuery<GuestSlotAvailability>({
    queryKey: guestKeys.slots(itemId ?? 'none', date, language),
    queryFn: () => fetchSlots(itemId as string, date, language),
    enabled: isReady && enabled && Boolean(itemId) && Boolean(date),
    staleTime: 10_000,
  });
}

/**
 * Prices the cart on the server. THE single source of every charge line and of
 * the grand total the checkout shows — the client renders `quote.total_minor`
 * verbatim and never sums charges itself. Re-runs whenever the quote-relevant
 * body (lines, location, delivery mode, tip) changes; `keepPreviousData` holds
 * the last total on screen while the next quote is in flight so the layout never
 * flickers. `signature` is a stable serialization of that body used as the key.
 */
export function useCartQuote(
  payload: CreateOrderPayload,
  signature: string,
  enabled: boolean,
) {
  const language = useGuestLanguage();
  const { isReady } = useGuestSession();
  return useQuery<CartQuote>({
    queryKey: guestKeys.cartQuote(signature, language),
    queryFn: () => quoteCart(payload, language),
    enabled: isReady && enabled,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useGuestOrders() {
  const language = useGuestLanguage();
  const { isReady } = useGuestSession();
  return useQuery<GuestOrderList>({
    queryKey: guestKeys.orders(language),
    queryFn: () => fetchOrders(language),
    enabled: isReady,
    staleTime: 15_000,
  });
}

/**
 * The guest's live orders for the home strip. Kept fresh by the existing order
 * WS: every snapshot invalidates the `['guest','orders']` prefix (see
 * `useOrderLive`), which this key sits under, so a status/serve-by change or an
 * order going terminal is reconciled by REFETCHING the full list — never patched.
 */
export function useGuestActiveOrders() {
  const language = useGuestLanguage();
  const { isReady } = useGuestSession();
  return useQuery<GuestActiveOrders>({
    queryKey: guestKeys.activeOrders(language),
    queryFn: () => fetchActiveOrders(language),
    enabled: isReady,
    staleTime: 15_000,
  });
}

/**
 * The WebSocket normally keeps this entry fresh (it writes snapshots straight
 * into the cache). `pollMs` is the fallback used while the socket is down, so a
 * guest on a flaky connection still sees the status move.
 */
/**
 * The home screen, assembled by the server from the hotel's real offerings. Also
 * the source of the chat tab's unread badge (`unread_chat`).
 */
export function useGuestHome() {
  const language = useGuestLanguage();
  const { isReady } = useGuestSession();
  return useQuery<GuestHome>({
    queryKey: guestKeys.home(language),
    queryFn: () => fetchHome(language),
    enabled: isReady,
    staleTime: 30_000,
  });
}

/**
 * The guest's chat thread. While the socket is up it is kept fresh by snapshots
 * written straight into this cache entry (see `useChatLive`); the key is stable
 * (there is only one thread per guest) so the WS can overwrite it blindly.
 */
export function useGuestChat() {
  const language = useGuestLanguage();
  const { isReady } = useGuestSession();
  return useQuery<ChatSnapshot>({
    queryKey: guestKeys.chat,
    queryFn: () => fetchChat(language),
    enabled: isReady,
    staleTime: 10_000,
  });
}

/**
 * The review left for one order, or `null` when none exists. Enabled only once
 * the order is terminal (a review is impossible before then), so a live order
 * never fires this request.
 */
export function useGuestReview(orderId: string | undefined, enabled: boolean) {
  const language = useGuestLanguage();
  const { isReady } = useGuestSession();
  return useQuery<GuestReview | null>({
    queryKey: guestKeys.review(orderId ?? 'none'),
    queryFn: () => fetchReview(orderId as string, language),
    enabled: isReady && enabled && Boolean(orderId),
    staleTime: 30_000,
  });
}

export function useGuestOrder(orderId: string | undefined, pollMs?: number) {
  const language = useGuestLanguage();
  const { isReady } = useGuestSession();
  return useQuery<GuestOrder>({
    queryKey: guestKeys.order(orderId ?? 'none'),
    queryFn: () => fetchOrder(orderId as string, language),
    enabled: isReady && Boolean(orderId),
    staleTime: 10_000,
    refetchInterval: pollMs && pollMs > 0 ? pollMs : false,
  });
}
