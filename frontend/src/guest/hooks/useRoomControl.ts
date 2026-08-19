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

/** Обычный ритм опроса, когда состояние известно. */
const POLL_MS = 60_000;

/**
 * ПАУЗЫ ПЕРЕД ПОВТОРАМИ ХОЛОДНОГО ЧТЕНИЯ.
 *
 * Две попытки, 1.8 с и 3.0 с. Ни то, ни другое не выбрано на вкус:
 *
 * НИЖНЯЯ ГРАНИЦА ЗАДАНА КОДОМ. Сервер схлопывает одновременные чтения одного
 * устройства на `commands.READ_COALESCE_S` = 1.5 с. Повтор раньше этого срока
 * получил бы прежний результат, ни разу не сходив к оборудованию, — экран
 * перезапрашивал бы, а сервер отвечал заученным. 1.8 с — первое значение за
 * окном с запасом на дорогу.
 *
 * ФОРМА — КАК У ПОДТВЕРЖДЕНИЯ КОМАНДЫ. `commands.CONFIRM_DELAYS_S` устроен
 * так же: несколько попыток с растущей паузой, а не одна и не равномерная
 * очередь. Растущая пауза даёт медленному оборудованию второй шанс, не
 * превращая экран в опрос по кругу.
 *
 * ПОЧЕМУ ДВЕ, А НЕ ПЯТЬ. Каждая попытка стоит до `READ_BUDGET_S` = 2.5 с
 * настоящего ожидания: три чтения с паузами — это уже около десяти секунд,
 * в течение которых подпись «читаем состояние» перестаёт быть правдой и
 * становится способом не признать отказ. После второго повтора сервер и сам
 * называет молчание отказом, и экран показывает честное «обратитесь на
 * ресепшен» — а обычный опрос раз в минуту продолжает работать, так что
 * вернувшаяся связь всё равно доедет без F5.
 */
const COLD_READ_DELAYS_MS = [1_800, 3_000];

/**
 * Снимок состояния номера по REST.
 *
 * `staleTime: 0` осознанно: у экрана нет права показать вчерашнее состояние
 * номера. Каждое открытие — это перечитывание feedback'ов на сервере, а не
 * выдача кэша, и кэш здесь существует ровно как место, куда WS кладёт свежий
 * снимок.
 *
 * ХОЛОДНОЕ ЧТЕНИЕ ПЕРЕСПРАШИВАЕТСЯ САМО. Сервер отвечает `unavailable_kind:
 * "reading"`, когда оборудование промолчало первый раз: это неотличимо от
 * коннектора, поднявшегося секунду назад. Гость не должен жать F5, чтобы
 * выяснить, было это задержкой или поломкой, — экран выясняет сам.
 */
export function useRoomState(enabled = true) {
  const { isReady } = useGuestSession();
  /*
    СЧИТАЕМ ОТВЕТЫ, А НЕ ПРОГОНЫ.

    Первая версия считала эффектом на приход данных — и просчиталась ровно
    вдвое: React в StrictMode прогоняет эффекты дважды, счётчик за один ответ
    прыгал на два, и вторая пауза съедалась впустую. Экран переспрашивал один
    раз вместо двух, а тест на повтор поймал это счётчиком запросов.

    Поэтому попытка отмечается ОТМЕТКОЙ ВРЕМЕНИ ответа: сколько бы раз ни
    вызвали расчёт паузы, один и тот же ответ учтётся один раз. Ref, а не
    состояние: пересчёт паузы не должен сам вызывать перерисовку.
  */
  const cold = useRef({ at: 0, count: 0 });

  return useQuery<RoomStateSnapshot>({
    queryKey: guestKeys.room,
    queryFn: () => guestApi.get<RoomStateSnapshot>('/guest/room/state'),
    enabled: isReady && enabled,
    staleTime: 0,
    // Возврат доступности после сбоя гость проверять руками не должен
    // (ТЗ §6): пока экран открыт, состояние переспрашивается само.
    refetchInterval: (query) => {
      const at = query.state.dataUpdatedAt;
      if (query.state.data?.unavailable_kind !== 'reading') {
        // Успешное чтение, честный отказ, просьба назвать номер — во всех
        // случаях выяснять больше нечего, возвращаемся к обычному ритму.
        cold.current = { at, count: 0 };
        return POLL_MS;
      }
      if (at !== cold.current.at) {
        cold.current = { at, count: cold.current.count + 1 };
      }
      const { count } = cold.current;
      return count > 0 && count <= COLD_READ_DELAYS_MS.length
        ? COLD_READ_DELAYS_MS[count - 1]
        : POLL_MS;
    },
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
export function useRoomCommand(liveOnline = false) {
  const queryClient = useQueryClient();
  return useMutation<RoomCommandAccepted, unknown, RoomCommandInput>({
    mutationFn: (input) =>
      guestApi.post<RoomCommandAccepted>('/guest/room/command', {
        controlId: input.controlId,
        capability: input.capability ?? '',
        value: input.value ?? null,
      }),
    onSuccess: (accepted) => {
      // «Идёт обмен» ставится ИЗ ОТВЕТА СЕРВЕРА, а не перечитыванием снимка.
      // Сервер ответил 202 и `state: pending` — он принял команду и пометил
      // элемент в полёте; это факт, который у нас уже на руках. Значение при
      // этом НЕ трогается: состояние номера по-прежнему меняется только
      // подтверждением.
      queryClient.setQueryData<RoomStateSnapshot>(guestKeys.room, (snapshot) =>
        snapshot
          ? {
              ...snapshot,
              zones: snapshot.zones.map((zone) => ({
                ...zone,
                controls: zone.controls.map((control) =>
                  control.controlId === accepted.controlId
                    ? { ...control, state: 'pending' as const }
                    : control,
                ),
              })),
            }
          : snapshot,
      );
      // Перечитываем ТОЛЬКО когда канал не поднят: при живом канале снимок и
      // так придёт им, а лишний GET на каждую команду — это ещё тринадцать
      // опросов оборудования на ровном месте.
      if (!liveOnline) void queryClient.invalidateQueries({ queryKey: guestKeys.room });
    },
  });
}

/**
 * Подтверждение PIN отвечает РОВНО на один вопрос — «гость в номере». Про
 * готовность оборудования оно не знает ничего: в этот момент его никто не
 * спрашивал. Поэтому и в ответе только `room_verified`; готовность приезжает
 * снимком, который тут же перезапрашивается.
 */
export function useRoomVerify() {
  const queryClient = useQueryClient();
  return useMutation<{ room_verified: boolean }, unknown, { pin: string }>({
    mutationFn: (input) => guestApi.post('/guest/room/verify', { pin: input.pin }),
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
