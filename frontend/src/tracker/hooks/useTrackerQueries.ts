import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { fetchTrackerBoard, fetchTrackerPoints } from '../api/tracker';
import { trackerKeys } from '../api/queryKeys';
import type { TrackerBoard, TrackerPointsResponse, TrackerScope } from '../api/types';

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
