import { useQuery } from '@tanstack/react-query';

import { getMe } from './adminClient';

/**
 * ПРАВА КОНСОЛИ — ОДНО МЕСТО.
 *
 * Роль спрашивали в трёх экранах и тремя разными способами
 * (`role !== 'read_only'`, `role === 'owner'`, а где-то не спрашивали вовсе).
 * Разные способы задать один вопрос — это гарантия, что однажды они ответят
 * по-разному; а «не спрашивали вовсе» означало кнопку, которая ответит 403.
 *
 * ЭТО ВТОРОЙ РУБЕЖ, А НЕ ЕДИНСТВЕННЫЙ. Сервер отказывает сам (`@requires` на
 * каждой платформенной ручке), и прятать контрол — не защита, а вежливость:
 * не предлагать человеку то, что ему всё равно откажут. Полагаться на это
 * вместо серверной проверки нельзя, и здесь этого не делается.
 *
 * Соответствие правам сервера (`apps/hotels/api/platform/rights.py`):
 *   READ  — любой вошедший, отдельного признака не нужно;
 *   WRITE — поддержка и владелец → `canWrite`;
 *   OWNER — только владелец → `isOwner`.
 */
export interface ConsoleRights {
  role: string | undefined;
  /** Поддержка и владелец: правки, узлы, шаблоны, вход в отель. */
  canWrite: boolean;
  /** Только владелец: деньги, состав команды, необратимое. */
  isOwner: boolean;
  /** Права ещё не приехали — контролы не показываем, чтобы не мигали. */
  isLoading: boolean;
}

export function useRights(): ConsoleRights {
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: getMe });
  const role = me.data?.role;
  return {
    role,
    // Пока роль неизвестна, прав нет: показать кнопку и отобрать её через
    // секунду хуже, чем показать на секунду позже.
    canWrite: role !== undefined && role !== 'read_only',
    isOwner: role === 'owner',
    isLoading: me.isPending,
  };
}
