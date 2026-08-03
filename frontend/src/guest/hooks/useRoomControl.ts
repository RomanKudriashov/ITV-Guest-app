import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { guestApi, guestRoomSocketUrl } from '../api/client';
import { guestKeys } from '../api/queryKeys';
import { useGuestSession } from '../session/GuestSessionProvider';
import { useGuestLanguage } from './useGuestQueries';
import type {
  RoomCommandAccepted,
  RoomCommandOutcome,
  RoomStateSnapshot,
} from '../api/types';

export type RoomLiveStatus = 'connecting' | 'online' | 'offline';

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/**
 * Снимок состояния номера по REST.
 *
 * `staleTime: 0` осознанно: у экрана нет права показать вчерашнее состояние
 * номера. Каждое открытие — это перечитывание feedback'ов на сервере, а не
 * выдача кэша, и кэш здесь существует ровно как место, куда WS кладёт свежий
 * снимок.
 */
export function useRoomState(enabled = true) {
  const { isReady } = useGuestSession();
  return useQuery<RoomStateSnapshot>({
    queryKey: guestKeys.room,
    queryFn: () => guestApi.get<RoomStateSnapshot>('/room/state'),
    enabled: isReady && enabled,
    staleTime: 0,
    // Возврат доступности после сбоя гость проверять руками не должен
    // (ТЗ §6): пока экран открыт, состояние переспрашивается само.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export interface RoomCommandInput {
  controlId: string;
  capability?: string;
  value?: number | null;
}

/**
 * Отправка команды.
 *
 * Оптимистичных переключений НЕТ, и это главное решение экрана. Ответ 202
 * означает «принято», а не «сделано»; состояние меняется только после
 * подтверждения, которое приезжает снимком. Показать переключатель включённым
 * сразу значило бы соврать гостю о номере в единственный момент, когда он на
 * этот экран и смотрит.
 */
export function useRoomCommand() {
  const queryClient = useQueryClient();
  return useMutation<RoomCommandAccepted, unknown, RoomCommandInput>({
    mutationFn: (input) =>
      guestApi.post<RoomCommandAccepted>('/room/command', {
        controlId: input.controlId,
        capability: input.capability ?? '',
        value: input.value ?? null,
      }),
    onSuccess: () => {
      // Сервер уже пометил элемент как «в полёте» — перечитываем, чтобы
      // показать «в процессе» даже если WS в этот момент не поднят.
      void queryClient.invalidateQueries({ queryKey: guestKeys.room });
    },
  });
}

export function useRoomVerify() {
  const queryClient = useQueryClient();
  return useMutation<{ can_command: boolean }, unknown, { pin: string }>({
    mutationFn: (input) => guestApi.post('/room/verify', { pin: input.pin }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: guestKeys.room });
      void queryClient.invalidateQueries({ queryKey: guestKeys.session });
    },
  });
}

/**
 * Живое состояние номера по WebSocket.
 *
 * Реконсиляция, а не дельты — тот же приём, что у заказа: сервер шлёт ПОЛНЫЙ
 * снимок на подключение и на каждое событие, снимок пишется прямо в кэш
 * react-query. Именно это делает безвредными пропущенное сообщение,
 * переподключение и гонку с REST.
 *
 * Отдельно возвращается исход последней команды: без него гость не отличил бы
 * «подтвердилось» от «вернулось на место» — в обоих случаях приезжает снимок.
 */
export function useRoomLive(enabled = true): {
  status: RoomLiveStatus;
  lastCommand: RoomCommandOutcome | null;
  clearLastCommand: () => void;
} {
  const queryClient = useQueryClient();
  const language = useGuestLanguage();
  const [status, setStatus] = useState<RoomLiveStatus>('connecting');
  const [lastCommand, setLastCommand] = useState<RoomCommandOutcome | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
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
      const url = guestRoomSocketUrl(language);
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
        // Счётчик обнуляется на УСПЕШНОМ открытии, а не на попытке: иначе
        // пауза не растёт и мы долбим сервер в цикле.
        attemptRef.current = 0;
        setStatus('online');
      };

      socket.onmessage = (event) => {
        if (disposed) return;
        let message: {
          type?: string;
          room?: RoomStateSnapshot;
          command?: RoomCommandOutcome | null;
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
        if (message.type === 'room.snapshot' && message.room) {
          // Заменяем целиком, никогда не сливаем.
          queryClient.setQueryData(guestKeys.room, message.room);
          if (message.command) setLastCommand(message.command);
        }
      };

      socket.onerror = () => {
        if (!disposed) setStatus('offline');
      };

      socket.onclose = (event) => {
        if (disposed) return;
        socketRef.current = null;
        setStatus('offline');
        // 4401 (протух токен), 4403 (модуль выключен / номера нет),
        // 4404 (не тот отель) — терминальные, переподключаться незачем.
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
  }, [enabled, language, queryClient]);

  // Стабильная ссылка: экран вешает на неё эффект, и пересоздание колбэка на
  // каждый рендер гоняло бы этот эффект вхолостую.
  const clearLastCommand = useCallback(() => setLastCommand(null), []);

  return { status, lastCommand, clearLastCommand };
}
