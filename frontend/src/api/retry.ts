import { ApiError } from './client';

/**
 * ПОВТОР ЛЕЧИТ ТОЛЬКО ТО, ЧТО МОЖЕТ ПРОЙТИ САМО: СБОЙ СЕТИ И 5xx.
 *
 * Ответ 4xx — это ответ, а не сбой: «начало периода позже конца» (422), «нет
 * прав» (403), «не найдено» (404) через секунду будут ровно теми же. Прежнее
 * умолчание `retry: 1` повторяло всё подряд, и внешний аудит поймал это на
 * «Отзывах» (ADM-001): перевёрнутый период давал ЧЕТЫРЕ 422 вместо двух, а
 * пользователь лишнюю секунду смотрел на крутилку перед тем же отказом.
 *
 * Правило одно на всё приложение — умолчание `QueryClient` в `main.tsx`.
 * Экранам свой `retry` заводить незачем; если понадобится другое ЧИСЛО
 * попыток, — `retryTransientUpTo(n)`, но не другое правило.
 */
export function isTransient(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500;
  // Не ApiError — значит до ответа сервера не дошло: сеть, обрыв, CORS.
  // Отмена запроса (AbortError) повтором не лечится и не нужна.
  return !(error instanceof DOMException && error.name === 'AbortError');
}

export function retryTransientUpTo(attempts: number) {
  return (failureCount: number, error: unknown) => failureCount < attempts && isTransient(error);
}

/** Умолчание приложения: одна повторная попытка — и только на сбое. */
export const retryTransient = retryTransientUpTo(1);
