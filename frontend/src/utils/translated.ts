import type { Translated } from '@/api/types';

/**
 * Reads a translatable field for display: current UI language first, then the
 * hotel default, then any filled language, then an empty string.
 */
export function pickTranslated(
  value: Translated | undefined | null,
  language: string,
  fallbackLanguage?: string,
): string {
  if (!value) return '';
  const direct = value[language];
  if (direct && direct.trim()) return direct;
  if (fallbackLanguage) {
    const fallback = value[fallbackLanguage];
    if (fallback && fallback.trim()) return fallback;
  }
  for (const candidate of Object.values(value)) {
    if (candidate && candidate.trim()) return candidate;
  }
  return '';
}

/** Languages of a translatable field that carry a non-empty value. */
export function filledLanguages(value: Translated | undefined | null): string[] {
  if (!value) return [];
  return Object.entries(value)
    .filter(([, text]) => Boolean(text && text.trim()))
    .map(([code]) => code);
}

/** Drops empty languages — the contract says empty languages are simply absent. */
export function compactTranslated(value: Translated): Translated {
  const result: Translated = {};
  for (const [code, text] of Object.entries(value)) {
    if (text && text.trim()) result[code] = text.trim();
  }
  return result;
}

export function setTranslated(
  value: Translated,
  language: string,
  text: string,
): Translated {
  return { ...value, [language]: text };
}
