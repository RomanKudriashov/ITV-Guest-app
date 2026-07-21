import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import {
  fetchItem,
  fetchLocations,
  fetchMenu,
  fetchOrder,
  fetchOrders,
} from '../api/guest';
import { guestKeys } from '../api/queryKeys';
import { useGuestSession } from '../session/GuestSessionProvider';
import type {
  GuestLocations,
  GuestMenu,
  GuestOrder,
  GuestOrderList,
  ItemDetail,
} from '../api/types';

/** Interface language, normalized — texts arrive already localized from the API. */
export function useGuestLanguage(): string {
  const { i18n } = useTranslation();
  return (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];
}

export function useGuestMenu() {
  const language = useGuestLanguage();
  const { isReady } = useGuestSession();
  return useQuery<GuestMenu>({
    queryKey: guestKeys.menu(language),
    queryFn: () => fetchMenu(language),
    enabled: isReady,
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

export function useGuestLocations() {
  const language = useGuestLanguage();
  const { isReady } = useGuestSession();
  return useQuery<GuestLocations>({
    queryKey: guestKeys.locations(language),
    queryFn: () => fetchLocations(language),
    enabled: isReady,
    staleTime: 5 * 60_000,
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
