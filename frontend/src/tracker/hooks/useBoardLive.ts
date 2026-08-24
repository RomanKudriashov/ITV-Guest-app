import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { trackerSocketUrl } from '../api/tracker';
import { trackerKeys } from '../api/queryKeys';
import { useTrackerLanguage } from './useTrackerQueries';
import type {
  TrackerBoard,
  TrackerSnapshotMessage,
  TrackerSocketMessage,
} from '../api/types';

export type LiveStatus = 'connecting' | 'online' | 'offline';

export interface BoardLive {
  status: LiveStatus;
  /**
   * ПРИДЕРЖАТЬ СНИМКИ, ПОКА ПАЛЕЦ НА КАРТОЧКЕ.
   *
   * Снимок ЗАМЕНЯЕТ доску целиком — в этом вся его надёжность, но во время
   * перетаскивания это значит, что колонки перестраиваются под рукой: карточка
   * уезжает из-под пальца, а цель броска оказывается не там, где была.
   * Перетаскивание длится секунду-две, задержка незаметна.
   *
   * Снимки при этом НЕ ТЕРЯЮТСЯ: копится последний, и он полный — именно
   * поэтому его достаточно. На отпускании он применяется.
   */
  hold: (on: boolean) => void;
}

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export interface BoardLiveEvent {
  /** `connected` for the first snapshot, otherwise `order.created` & co. */
  event: string;
  orderId?: string;
  board: TrackerBoard;
}

/**
 * Live board over WebSocket — the tracker twin of `useOrderLive`.
 *
 * RECONCILIATION ONLY: the server pushes a full board snapshot on connect and
 * after every event of the point, and the snapshot REPLACES the query cache
 * entry (`setQueryData`). No delta is ever applied on top of local state, which
 * is what makes a dropped message, a reconnect or a race with a REST action
 * harmless — exactly the invariant the guest side relies on.
 *
 * Reconnects with exponential backoff and reports `offline` so the UI can say so.
 */
export function useBoardLive(
  pointCode: string | undefined,
  enabled: boolean,
  onEvent?: (event: BoardLiveEvent) => void,
): BoardLive {
  const queryClient = useQueryClient();
  const language = useTrackerLanguage();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  // Придержка снимков на время перетаскивания. Ref, а не состояние: смена
  // флага не должна пересобирать сокет.
  const heldRef = useRef(false);
  const pendingRef = useRef<(() => void) | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  // Kept in a ref so a new callback identity never tears down the socket.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!pointCode || !enabled) {
      setStatus('offline');
      return;
    }

    let disposed = false;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      const delay = Math.min(BASE_DELAY_MS * 2 ** attemptRef.current, MAX_DELAY_MS);
      attemptRef.current += 1;
      clearTimer();
      timerRef.current = window.setTimeout(connect, delay);
    };

    function connect() {
      if (disposed) return;
      const url = trackerSocketUrl(pointCode as string, language);
      if (!url) {
        setStatus('offline');
        return;
      }
      setStatus((prev) => (prev === 'online' ? 'connecting' : prev));

      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        setStatus('offline');
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) return;
        attemptRef.current = 0;
        setStatus('online');
      };

      socket.onmessage = (event) => {
        if (disposed) return;
        let message: TrackerSocketMessage;
        try {
          message = JSON.parse(String(event.data)) as TrackerSocketMessage;
        } catch {
          return;
        }
        if (message.type === 'ping') {
          try {
            socket.send(JSON.stringify({ type: 'pong' }));
          } catch {
            /* socket already closing */
          }
          return;
        }
        if (message.type !== 'tracker.snapshot') return;
        const snapshot = message as TrackerSnapshotMessage;
        const board = snapshot.board;
        if (!board) return;
        const scope = board.scope ?? 'active';
        const code = board.point?.code ?? pointCode;

        const apply = () => {
          // Replace, never merge.
          //
          // Снимок из сокета НЕФИЛЬТРОВАННЫЙ, поэтому кладём его только по
          // ключу без сужения. Открытую суженную доску им подменять нельзя —
          // она показала бы чужие заказы; её просто будим, и она перечитает
          // своё с сервера, уже с фильтром.
          queryClient.setQueryData(trackerKeys.board(code as string, scope, language), board);
          void queryClient.invalidateQueries({
            queryKey: trackerKeys.boards,
            refetchType: 'active',
            predicate: (query) => Boolean(query.queryKey[6]),
          });
          // Point badges (active/new counts) move with the board.
          void queryClient.invalidateQueries({
            queryKey: ['tracker', 'points'],
            refetchType: 'active',
          });
          onEventRef.current?.({
            event: snapshot.event ?? 'snapshot',
            orderId: snapshot.order_id,
            board,
          });
        };

        if (heldRef.current) {
          // Копим ПОСЛЕДНИЙ, а не очередь: снимок полный, и предыдущие в нём
          // уже учтены. Хранить их все значило бы применить на отпускании
          // стопку устаревших досок подряд.
          pendingRef.current = apply;
          return;
        }
        apply();
      };

      socket.onerror = () => {
        if (!disposed) setStatus('offline');
      };

      socket.onclose = (event) => {
        if (disposed) return;
        socketRef.current = null;
        setStatus('offline');
        // 4401 bad token, 4403 not assigned, 4404 unknown hotel/point — terminal.
        if (event.code === 4401 || event.code === 4403 || event.code === 4404) return;
        scheduleReconnect();
      };
    }

    connect();

    const onOnline = () => {
      attemptRef.current = 0;
      if (!socketRef.current) connect();
    };
    window.addEventListener('online', onOnline);

    return () => {
      disposed = true;
      window.removeEventListener('online', onOnline);
      clearTimer();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
      }
    };
  }, [pointCode, enabled, language, queryClient]);

  // Стабильная ссылка: `hold` уезжает в обработчики перетаскивания, и новая
  // функция на каждый рендер пересоздавала бы их вместе с DndContext.
  const hold = useCallback((on: boolean) => {
    heldRef.current = on;
    if (on) return;
    const pending = pendingRef.current;
    pendingRef.current = null;
    // Применяем накопленное СРАЗУ на отпускании: доска догоняет жизнь одним
    // шагом, а не остаётся на снимке минутной давности до следующего события.
    pending?.();
  }, []);

  return { status, hold };
}
