import i18n from 'i18next';

/**
 * ДАТЫ ПО ЯЗЫКУ ИНТЕРФЕЙСА (партия 62-D). `toLocaleString()` без языка
 * берёт язык браузера, и русская консоль показывала «10/19/2026, 2:29 PM».
 */
function language(): string {
  return (i18n.resolvedLanguage ?? i18n.language ?? 'ru').split('-')[0] || 'ru';
}

/** «21 окт. 2026 г., 17:24» */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return new Date(value).toLocaleString(language(), { dateStyle: 'medium', timeStyle: 'short' });
}

/** «21 октября 2026 г.» */
export function formatDate(value: string | number | Date | null | undefined, style: 'medium' | 'long' = 'long'): string {
  if (value === null || value === undefined || value === '') return '';
  return new Date(value).toLocaleDateString(language(), { dateStyle: style });
}
