import type { LiveStatus } from './hooks/useBoardLive';

/**
 * СВЯЗЬ ДОСКИ — ОДНО МЕСТО ПРАВДЫ (партия 42).
 *
 * Раньше у доски было два суждения о связи, и они спорили на одном экране:
 * карточка «Связь с доской потеряна» смотрела на ошибку REST-запроса, а подпись
 * под доской — на сокет. На стенде сокет жил и присылал снимки, а запрос доски
 * оборвался, и смена видела разом «связь потеряна» и «обновляется в реальном
 * времени». Теперь и карточка, и подпись читают одно значение отсюда.
 *
 *   online       — сокет на связи: доска живая;
 *   reconnecting — сокета нет, но опрос отвечает: данные свежие, только не
 *                  мгновенные;
 *   offline      — сокета нет и опрос молчит дольше двух своих интервалов,
 *                  ИЛИ браузер сам знает, что сети нет (партия 44, п.77):
 *                  пустоте верить нельзя.
 *
 * Сеть браузера проверяется ПЕРВОЙ, раньше сокета: при выключенной сети уже
 * открытый сокет может ещё числиться живым (Chromium его не рвёт сразу), а
 * опрос стоит на паузе — «в реальном времени» и «переподключаемся» оба были бы
 * неправдой.
 */
export type BoardLink = 'online' | 'reconnecting' | 'offline';

export function boardLink(
  live: LiveStatus,
  dataUpdatedAt: number,
  now: number,
  pollMs: number,
  networkOnline = true,
): BoardLink {
  if (!networkOnline) return 'offline';
  if (live === 'online') return 'online';
  const fresh = dataUpdatedAt > 0 && now - dataUpdatedAt <= pollMs * 2;
  return fresh ? 'reconnecting' : 'offline';
}

/** Подпись под доской — по тому же значению, что и карточка обрыва. */
export const BOARD_LINK_CAPTION: Record<BoardLink, string> = {
  online: 'tracker.liveOn',
  reconnecting: 'tracker.liveReconnecting',
  offline: 'tracker.liveLost',
};
