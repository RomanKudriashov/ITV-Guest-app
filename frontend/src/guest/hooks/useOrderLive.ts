import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { guestOrderSocketUrl } from '../api/client';
import { guestKeys } from '../api/queryKeys';
import { useGuestLanguage } from './useGuestQueries';
import type { GuestOrder } from '../api/types';

export type LiveStatus = 'connecting' | 'online' | 'offline';

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/**
 * Live order status over WebSocket.
 *
 * RECONCILIATION ONLY: the server sends a full order snapshot on connect and on
 * every change, and the snapshot is written straight into the react-query cache
 * (`setQueryData`). Deltas are never applied on top of local state — that is what
 * makes a missed message, a reconnect or a race with REST harmless.
 *
 * Reconnects with exponential backoff and reports `offline` so the UI can say so.
 */
export function useOrderLive(orderId: string | undefined, enabled = true): LiveStatus {
  const queryClient = useQueryClient();
  const language = useGuestLanguage();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!orderId || !enabled) {
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
      const url = guestOrderSocketUrl(orderId as string, language);
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
        let message: { type?: string; order?: GuestOrder };
        try {
          message = JSON.parse(String(event.data)) as { type?: string; order?: GuestOrder };
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
        if (message.type === 'order.snapshot' && message.order) {
          // Replace, never merge.
          queryClient.setQueryData(guestKeys.order(message.order.id), message.order);
          void queryClient.invalidateQueries({
            queryKey: ['guest', 'orders'],
            refetchType: 'active',
          });
        }
      };

      socket.onerror = () => {
        if (!disposed) setStatus('offline');
      };

      socket.onclose = (event) => {
        if (disposed) return;
        socketRef.current = null;
        setStatus('offline');
        // 4401 (bad token / foreign order) and 4404 (no hotel) are terminal.
        if (event.code === 4401 || event.code === 4404) return;
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
  }, [orderId, enabled, language, queryClient]);

  return status;
}
