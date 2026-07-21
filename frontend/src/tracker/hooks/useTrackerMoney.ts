import { useCallback } from 'react';

import { useAuth } from '@/auth';
import { formatMoney } from '@/utils/money';
import { useTrackerLanguage } from './useTrackerQueries';

/**
 * Money on the board.
 *
 * The currency travels with the order, the exponent comes from the hotel the
 * staff token belongs to — so the tracker needs no extra request just to print
 * a total.
 */
export function useTrackerMoney() {
  const { hotel } = useAuth();
  const language = useTrackerLanguage();
  const minorUnits = hotel?.currency_minor_units ?? 2;
  const fallbackCurrency = hotel?.currency ?? 'RUB';

  const format = useCallback(
    (minor: number, currency?: string) =>
      formatMoney(minor, currency || fallbackCurrency, minorUnits, language, {
        trimZeroFraction: true,
      }),
    [fallbackCurrency, minorUnits, language],
  );

  return { format };
}
