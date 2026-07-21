/**
 * Money helpers. The API speaks integer minor units (копейки); the UI shows and
 * accepts major units (рубли).
 *
 * `bootstrap.hotel.currency_minor_units` is the number of decimal places
 * (RUB → 2, i.e. a factor of 100). Values of 10 and above are interpreted as a
 * ready-made factor instead, so both conventions work.
 */

function decimals(minorUnits: number): number {
  if (!Number.isFinite(minorUnits) || minorUnits < 0) return 2;
  if (minorUnits >= 10) return Math.max(0, Math.round(Math.log10(minorUnits)));
  return Math.round(minorUnits);
}

function factor(minorUnits: number): number {
  return 10 ** decimals(minorUnits);
}

/** 190000 → "1900.00" (for a text input). */
export function minorToInput(minor: number, minorUnits: number): string {
  return (minor / factor(minorUnits)).toFixed(decimals(minorUnits));
}

/** "1900,50" → 190050. Returns null when the text is not a valid amount. */
export function inputToMinor(value: string, minorUnits: number): number | null {
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  if (!normalized) return null;
  if (!/^-?\d*\.?\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * factor(minorUnits));
}

/** "RUB" → "₽" for field adornments; falls back to the ISO code. */
export function currencySymbol(currency: string, language: string): string {
  try {
    const parts = new Intl.NumberFormat(language, {
      style: 'currency',
      currency,
    }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

export interface FormatMoneyOptions {
  /**
   * Drop the fractional part when it is zero: menus read better as "1 900 ₽"
   * than "1 900,00 ₽". Off by default so editors keep seeing exact amounts.
   */
  trimZeroFraction?: boolean;
}

/** Localized price for read-only display. */
export function formatMoney(
  minor: number,
  currency: string,
  minorUnits: number,
  language: string,
  options: FormatMoneyOptions = {},
): string {
  const scale = factor(minorUnits);
  const amount = minor / scale;
  const digits = options.trimZeroFraction && minor % scale === 0 ? 0 : decimals(minorUnits);
  try {
    return new Intl.NumberFormat(language, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

/** Signed delta for modifier options: "+150,00 ₽". */
export function formatDelta(
  minor: number,
  currency: string,
  minorUnits: number,
  language: string,
  options: FormatMoneyOptions = {},
): string {
  const formatted = formatMoney(Math.abs(minor), currency, minorUnits, language, options);
  if (minor === 0) return formatted;
  return `${minor > 0 ? '+' : '−'}${formatted}`;
}
