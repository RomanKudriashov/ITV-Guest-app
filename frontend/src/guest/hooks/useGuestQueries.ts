import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { OfferingType } from '@/offerings/behaviour';
import {
  fetchCatalog,
  fetchItem,
  fetchLocations,
  fetchOrder,
  fetchOrders,
  fetchSlots,
} from '../api/guest';
import { guestKeys } from '../api/queryKeys';
import { useGuestSession } from '../session/GuestSessionProvider';
import type {
  GuestCatalog,
  GuestLocations,
  GuestOrder,
  GuestOrderList,
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
 * The WebSocket normally keeps this entry fresh (it writes snapshots straight
 * into the cache). `pollMs` is the fallback used while the socket is down, so a
 * guest on a flaky connection still sees the status move.
 */
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
