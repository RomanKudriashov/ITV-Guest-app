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

/** Значение, которого нет. Одно на весь раздел, чтобы «нет» выглядело одинаково. */
export const MISSING = '—';

/** Число, которое можно показать: не `null`, не `undefined`, не NaN и не бесконечность. */
type Maybe = number | null | undefined;

function shown(value: Maybe): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Formatters bound to the hotel currency and the UI language. Money uses the
 * hotel's minor-unit exponent; everything else uses `Intl` in the UI locale.
 *
 * КАЖДЫЙ ФОРМАТТЕР ПРИНИМАЕТ «НЕТ ЗНАЧЕНИЯ» И РИСУЕТ ПРОЧЕРК. Вкладка
 * «Операции» однажды читала поля, которых сервер не слал, и `Intl` честно
 * отформатировал `undefined` в «NaN» и «не число %». Типы тогда не спасли:
 * TypeScript верит объявлению ответа. Защита здесь — последняя линия: какой
 * бы формы ни приехал ответ, в плитке будет «—», а не мусор.
 */
export function useMetricFormatters() {
  const { hotel } = useAuth();
  const language = useAnalyticsLanguage();
  const minorUnits = hotel?.currency_minor_units ?? 2;
  const currency = hotel?.currency ?? 'RUB';

  const money = useCallback(
    (minor: Maybe) =>
      shown(minor)
        ? formatMoney(minor, currency, minorUnits, language, { trimZeroFraction: true })
        : MISSING,
    [currency, minorUnits, language],
  );

  const count = useCallback(
    (value: Maybe) =>
      shown(value) ? new Intl.NumberFormat(language).format(Math.round(value)) : MISSING,
    [language],
  );

  const decimal = useCallback(
    (value: Maybe) =>
      shown(value)
        ? new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value)
        : MISSING,
    [language],
  );

  const percent = useCallback(
    (fraction: Maybe) =>
      shown(fraction)
        ? new Intl.NumberFormat(language, {
            style: 'percent',
            maximumFractionDigits: 1,
          }).format(fraction)
        : MISSING,
    [language],
  );

  const duration = useCallback(
    (seconds: Maybe) => (shown(seconds) ? formatDuration(seconds) : MISSING),
    [],
  );

  const rating = useCallback(
    (value: Maybe) =>
      shown(value)
        ? new Intl.NumberFormat(language, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }).format(value)
        : MISSING,
    [language],
  );

  const value = useCallback(
    (raw: Maybe, kind: MetricFormat) => {
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
    (fraction: Maybe) =>
      shown(fraction)
        ? new Intl.NumberFormat(language, {
            style: 'percent',
            maximumFractionDigits: 1,
            signDisplay: 'always',
          }).format(fraction)
        : MISSING,
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
