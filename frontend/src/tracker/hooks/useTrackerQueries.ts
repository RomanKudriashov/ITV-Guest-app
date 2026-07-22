import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import {
  fetchChatThread,
  fetchChatThreads,
  fetchTrackerBoard,
  fetchTrackerOrder,
  fetchTrackerPoints,
} from '../api/tracker';
import { trackerKeys } from '../api/queryKeys';
import type {
  TrackerBoard,
  TrackerChatSnapshot,
  TrackerChatThread,
  TrackerOrder,
  TrackerPointsResponse,
  TrackerScope,
} from '../api/types';

/** Interface language, normalized — board texts arrive already localized. */
export function useTrackerLanguage(): string {
  const { i18n } = useTranslation();
  return (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];
}

export function useTrackerPoints() {
  const language = useTrackerLanguage();
  return useQuery<TrackerPointsResponse>({
    queryKey: trackerKeys.points(language),
    queryFn: () => fetchTrackerPoints(language),
    staleTime: 60_000,
  });
}

/**
 * The board. While the socket is up it is kept fresh by snapshots written
 * straight into this cache entry (see `useBoardLive`); `pollMs` is the fallback
 * used when the socket is down, so a kitchen on flaky wifi still sees new orders.
 */
export function useTrackerBoard(
  point: string | undefined,
  scope: TrackerScope,
  pollMs?: number,
) {
  const language = useTrackerLanguage();
  return useQuery<TrackerBoard>({
    queryKey: trackerKeys.board(point ?? 'none', scope, language),
    queryFn: () => fetchTrackerBoard(point as string, scope, language),
    enabled: Boolean(point),
    staleTime: 10_000,
    refetchInterval: pollMs && pollMs > 0 ? pollMs : false,
  });
}

/**
 * A single order, fetched ONLY when the deep link points at something the
 * current board snapshot does not contain (another point, another scope, a page
 * opened cold). A normal tap on a card passes the order in and this stays idle.
 *
 * Not retried on 403/404: "not yours" and "does not exist" are answers, not
 * hiccups, and repeating them just delays the message.
 */
export function useTrackerOrder(orderId: string | undefined, enabled: boolean) {
  const language = useTrackerLanguage();
  return useQuery<TrackerOrder>({
    queryKey: trackerKeys.order(orderId ?? 'none', language),
    queryFn: () => fetchTrackerOrder(orderId as string, language),
    enabled: enabled && Boolean(orderId),
    staleTime: 10_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        return false;
      }
      return failureCount < 1;
    },
  });
}

/**
 * The hotel's chat threads. Kept lightly fresh; the WS of the open thread also
 * invalidates it so unread counts move without a manual refetch.
 */
export function useTrackerChatThreads(enabled = true) {
  const language = useTrackerLanguage();
  return useQuery<TrackerChatThread[]>({
    queryKey: trackerKeys.chatThreads(language),
    queryFn: () => fetchChatThreads(language),
    enabled,
    staleTime: 15_000,
    refetchInterval: enabled ? 20_000 : false,
  });
}

/**
 * One open thread. While the socket is up it is kept fresh by snapshots written
 * straight into this cache entry (see `useChatLive`).
 */
export function useTrackerChatThread(threadId: string | null) {
  const language = useTrackerLanguage();
  return useQuery<TrackerChatSnapshot>({
    queryKey: trackerKeys.chatThread(threadId ?? 'none'),
    queryFn: () => fetchChatThread(threadId as string, language),
    enabled: Boolean(threadId),
    staleTime: 10_000,
  });
}
