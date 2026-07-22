import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

import type { ChatSnapshot } from '@/guest/api/types';

export type LiveStatus = 'connecting' | 'online' | 'offline';

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export interface UseChatLiveParams {
  /** Full WS URL (token/hotel/lang already baked in), or `null` when not ready. */
  url: string | null;
  /** Cache entry the snapshot REPLACES — the guest thread, or one staff thread. */
  queryKey: QueryKey;
  enabled?: boolean;
  /** Fired after each snapshot is stored — used to refresh unread badges. */
  onSnapshot?: (snapshot: ChatSnapshot) => void;
}

/**
 * Live chat over WebSocket — the shared twin of `useOrderLive`/`useBoardLive`,
 * used unchanged by both the guest and staff sides (only `url` and `queryKey`
 * differ).
 *
 * RECONCILIATION ONLY: the server sends a full thread snapshot on connect and on
 * every message of either party, and the snapshot is written straight into the
 * react-query cache (`setQueryData`). No delta is ever applied on top of local
 * state — which is what makes a dropped frame, a reconnect or a race with a REST
 * send harmless. The draft the user is typing lives in `useDraftState`, so a
 * snapshot never wipes half-typed text.
 *
 * Reconnects with exponential backoff and reports `offline` so the UI can say so.
 */
export function useChatLive({
  url,
  queryKey,
  enabled = true,
  onSnapshot,
}: UseChatLiveParams): LiveStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;

  // Serialize the key so a fresh array identity does not tear the socket down.
  const keyId = JSON.stringify(queryKey);

  useEffect(() => {
    if (!url || !enabled) {
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
      setStatus((prev) => (prev === 'online' ? 'connecting' : prev));

      let socket: WebSocket;
      try {
        socket = new WebSocket(url as string);
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
        let message: {
          type?: string;
          thread?: ChatSnapshot;
          snapshot?: ChatSnapshot;
          messages?: unknown;
        };
        try {
          message = JSON.parse(String(event.data));
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
        // The snapshot travels under `thread` (`{type:'chat.snapshot', thread}`);
        // accept a couple of shapes so a backend tweak never silently breaks live.
        const snapshot: ChatSnapshot | null =
          message.thread ??
          message.snapshot ??
          (Array.isArray(message.messages) ? (message as unknown as ChatSnapshot) : null);
        if (!snapshot) return;
        // Replace, never merge.
        queryClient.setQueryData(queryKey, snapshot);
        onSnapshotRef.current?.(snapshot);
      };

      socket.onerror = () => {
        if (!disposed) setStatus('offline');
      };

      socket.onclose = (event) => {
        if (disposed) return;
        socketRef.current = null;
        setStatus('offline');
        // 4401 bad token, 4403 foreign thread, 4404 unknown hotel — terminal.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled, keyId, queryClient]);

  return status;
}
