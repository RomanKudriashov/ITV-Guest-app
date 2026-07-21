import { useCallback } from 'react';

import { formatDelta, formatMoney } from '@/utils/money';
import { useGuestSession } from '../session/GuestSessionProvider';
import { useGuestLanguage } from './useGuestQueries';

/**
 * Money formatting bound to the hotel's currency.
 * `currency_minor_units` is an EXPONENT (2 for RUB), not a multiplier.
 */
export function useMoney() {
  const { currency, minorUnits } = useGuestSession();
  const language = useGuestLanguage();

  // Storefront prices read better without a zero fraction: "1 900 ₽".
  const format = useCallback(
    (minor: number) =>
      formatMoney(minor, currency, minorUnits, language, { trimZeroFraction: true }),
    [currency, minorUnits, language],
  );

  const delta = useCallback(
    (minor: number) =>
      formatDelta(minor, currency, minorUnits, language, { trimZeroFraction: true }),
    [currency, minorUnits, language],
  );

  /**
   * `null` means "price not set" (a service may be unpriced) — the caller gets
   * `null` back and hides the element instead of printing a misleading "0 ₽".
   */
  const formatOptional = useCallback(
    (minor: number | null | undefined) =>
      minor === null || minor === undefined ? null : format(minor),
    [format],
  );

  return { format, formatOptional, delta, currency, minorUnits };
}
