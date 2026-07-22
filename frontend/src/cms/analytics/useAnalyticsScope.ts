import { useQuery } from '@tanstack/react-query';

import { fetchScope } from '@/api/analytics';
import type { AnalyticsScope } from '@/api/analyticsTypes';
import { queryKeys } from '@/api/queryKeys';

/**
 * Permission scope for the analytics dashboard. Point-scoped staff only see
 * their points, so the point filter is pinned/limited to what this returns;
 * the front-end never guesses the scope.
 */
export function useAnalyticsScope() {
  return useQuery<AnalyticsScope>({
    queryKey: queryKeys.analyticsScope,
    queryFn: fetchScope,
    staleTime: 5 * 60 * 1000,
    // Backend may 404 until it lands — don't hammer it.
    retry: 1,
  });
}
