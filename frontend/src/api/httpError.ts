/**
 * ТЕКСТ ОШИБКИ ДЛЯ ЧЕЛОВЕКА — ОДНО МЕСТО (партия 39).
 *
 * На экран входа гостя попала сырая страница Django «<!doctype html>…Bad
 * Request (400)…»: клиенты клали тело ответа в текст ошибки, если оно не JSON.
 * Тело ответа показывается человеку ТОЛЬКО если это наш JSON с текстом
 * (`detail`/`message`); иначе — понятная фраза по коду ответа на языке
 * интерфейса. Им пользуются все клиенты: панели и трекера (`api/client`),
 * гостя (`guest/api/client`), консоли (`admin/adminClient`).
 */
import { i18n } from '@/i18n';

/** Фраза по коду ответа; 0 — сети нет (запрос не дошёл). */
export function httpErrorText(status: number): string {
  if (status === 0) return i18n.t('common.httpErrors.network');
  if (status === 400) return i18n.t('common.httpErrors.badRequest');
  if (status === 401) return i18n.t('common.httpErrors.unauthorized');
  if (status === 403) return i18n.t('common.httpErrors.forbidden');
  if (status === 404) return i18n.t('common.httpErrors.notFound');
  if (status === 429) return i18n.t('common.httpErrors.tooMany');
  if (status >= 500) return i18n.t('common.httpErrors.server');
  return i18n.t('common.httpErrors.generic');
}

/** Текст сервера — если это наш JSON с текстом; иначе фраза по коду. */
export function errorDetail(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['detail', 'message'] as const) {
      const value = record[key];
      if (typeof value === 'string' && value.trim() && !looksLikeMarkup(value)) return value;
    }
  }
  return httpErrorText(status);
}

/** Разметка в тексте — признак чужого ответа (прокси, страница ошибки), не нашего. */
function looksLikeMarkup(text: string): boolean {
  return /<\s*(!doctype|html|head|body|title|h1|p|div)\b/i.test(text);
}
