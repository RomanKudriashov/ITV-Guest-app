import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/auth';
import { formatMoney } from '@/utils/money';

/** How a metric value is rendered — drives both summary cards and tables. */
export type MetricFormat = 'count' | 'money' | 'decimal' | 'percent' | 'duration' | 'rating';

/** Locale for number/date formatting from the active UI language. */
export function useAnalyticsLanguage(): string {
  const { i18n } = useTranslation();
  return (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];
}

/**
 * Formatters bound to the hotel currency and the UI language. Money uses the
 * hotel's minor-unit exponent; everything else uses `Intl` in the UI locale.
 */
export function useMetricFormatters() {
  const { hotel } = useAuth();
  const language = useAnalyticsLanguage();
  const minorUnits = hotel?.currency_minor_units ?? 2;
  const currency = hotel?.currency ?? 'RUB';

  const money = useCallback(
    (minor: number) =>
      formatMoney(minor, currency, minorUnits, language, { trimZeroFraction: true }),
    [currency, minorUnits, language],
  );

  const count = useCallback(
    (value: number) => new Intl.NumberFormat(language).format(Math.round(value)),
    [language],
  );

  const decimal = useCallback(
    (value: number) =>
      new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value),
    [language],
  );

  const percent = useCallback(
    (fraction: number) =>
      new Intl.NumberFormat(language, {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(fraction),
    [language],
  );

  const duration = useCallback(
    (seconds: number) => formatDuration(seconds),
    [],
  );

  const rating = useCallback(
    (value: number) =>
      new Intl.NumberFormat(language, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(value),
    [language],
  );

  const value = useCallback(
    (raw: number, kind: MetricFormat) => {
      switch (kind) {
        case 'money':
          return money(raw);
        case 'percent':
          return percent(raw);
        case 'duration':
          return duration(raw);
        case 'decimal':
          return decimal(raw);
        case 'rating':
          return rating(raw);
        case 'count':
        default:
          return count(raw);
      }
    },
    [money, percent, duration, decimal, rating, count],
  );

  const signedPercent = useCallback(
    (fraction: number) => {
      const formatted = new Intl.NumberFormat(language, {
        style: 'percent',
        maximumFractionDigits: 1,
        signDisplay: 'always',
      }).format(fraction);
      return formatted;
    },
    [language],
  );

  return { money, count, decimal, percent, duration, rating, value, signedPercent };
}

/** 190 → "3m 10s"; 45 → "45s"; 0 → "0s". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}
