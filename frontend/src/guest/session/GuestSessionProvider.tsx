import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useAppTheme } from '@/theme';
import { ApiError } from '@/api/client';
import { guestTokenStorage, setGuestUnauthorizedHandler } from '../api/client';
import { createSession, fetchSession } from '../api/guest';
import { guestKeys } from '../api/queryKeys';
import type { GuestHotel, GuestSession, RoomNotFoundPayload } from '../api/types';

interface GuestSessionContextValue {
  session: GuestSession | null;
  /** Hotel is known even when session creation failed with `room_not_found`. */
  hotel: GuestHotel | null;
  /** True while a token restored from localStorage is being validated. */
  isBootstrapping: boolean;
  isReady: boolean;
  /**
   * Витрину рисует ПОКАЗ бренда, а не гость.
   *
   * Нужен ровно в одном месте — в оболочке, которая иначе уводит на экран
   * входа, пока нет сессии. Гостевые запросы при этом остаются выключенными
   * (`isReady: false`), и показ не делает ни одного обращения в гостевые ручки:
   * данные ему кладут в кэш серверной ручкой панели.
   *
   * Отдельный признак, а не «поднять isReady»: поднятый флаг означал бы, что
   * сессия есть, и все гостевые запросы ушли бы в сеть без токена — так и
   * случилось в первой редакции, 401 на `/guest/orders/active`.
   */
  isPreview: boolean;
  canOrder: boolean;
  currency: string;
  minorUnits: number;
  /** Creates a session; throws `ApiError` so the caller can branch on the code. */
  start: (roomNumber: string | null) => Promise<GuestSession>;
  end: () => void;
}

const GuestSessionContext = createContext<GuestSessionContextValue | null>(null);

/** Session expiry is checked locally so we do not render a doomed menu. */
function isAlive(session: GuestSession | null): boolean {
  if (!session) return false;
  const expires = Date.parse(session.expires_at);
  return !Number.isFinite(expires) || expires > Date.now();
}

export function GuestSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();
  const { setBrandTokens } = useAppTheme();

  const [session, setSession] = useState<GuestSession | null>(null);
  const [hotel, setHotel] = useState<GuestHotel | null>(null);
  const [isBootstrapping, setBootstrapping] = useState<boolean>(() =>
    Boolean(guestTokenStorage.get()),
  );

  const applyHotel = useCallback(
    (next: GuestHotel | undefined | null) => {
      if (!next) return;
      setHotel(next);
      // Hotel brand tokens are merged on top of the platform defaults.
      setBrandTokens(next.theme);
    },
    [setBrandTokens],
  );

  const end = useCallback(() => {
    guestTokenStorage.clear();
    setSession(null);
    void queryClient.removeQueries({ queryKey: guestKeys.all });
  }, [queryClient]);

  // A guest whose token expired belongs on the entry screen, not on /login.
  useEffect(() => {
    setGuestUnauthorizedHandler(() => {
      guestTokenStorage.clear();
      setSession(null);
      if (window.location.pathname !== '/') window.location.assign('/');
    });
    return () => setGuestUnauthorizedHandler(null);
  }, []);

  // Restore a session from a token kept in localStorage.
  useEffect(() => {
    if (!guestTokenStorage.get() || session) {
      setBootstrapping(false);
      return;
    }
    let cancelled = false;
    setBootstrapping(true);
    fetchSession()
      .then((restored) => {
        if (cancelled) return;
        if (!isAlive(restored)) {
          guestTokenStorage.clear();
          return;
        }
        setSession(restored);
        applyHotel(restored.hotel);
      })
      .catch(() => {
        if (!cancelled) guestTokenStorage.clear();
      })
      .finally(() => {
        if (!cancelled) setBootstrapping(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, applyHotel]);

  const start = useCallback(
    async (roomNumber: string | null) => {
      const language = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];
      try {
        const created = await createSession({ room_number: roomNumber, language });
        guestTokenStorage.set(created.token, created.session_id);
        const { token: _token, ...rest } = created;
        void _token;
        setSession(rest);
        applyHotel(rest.hotel);
        // A fresh session invalidates everything cached for the previous one.
        void queryClient.removeQueries({ queryKey: guestKeys.all });
        return rest;
      } catch (error) {
        // `room_not_found` still carries the hotel so the brand stays on screen.
        if (error instanceof ApiError) {
          const payload = error.payload as unknown as RoomNotFoundPayload;
          if (payload?.hotel) applyHotel(payload.hotel);
        }
        throw error;
      }
    },
    [applyHotel, i18n, queryClient],
  );

  const value = useMemo<GuestSessionContextValue>(() => {
    const alive = isAlive(session);
    return {
      isPreview: false,
      session: alive ? session : null,
      hotel,
      isBootstrapping,
      isReady: alive,
      canOrder: alive && session?.trust !== 'anonymous',
      currency: session?.hotel.currency ?? hotel?.currency ?? 'RUB',
      minorUnits: session?.hotel.currency_minor_units ?? hotel?.currency_minor_units ?? 2,
      start,
      end,
    };
  }, [session, hotel, isBootstrapping, start, end]);

  return (
    <GuestSessionContext.Provider value={value}>{children}</GuestSessionContext.Provider>
  );
}

/**
 * СЕССИЯ ПОКАЗА — ЕЁ НЕТ, И ЭТО СКАЗАНО ЧЕСТНО.
 *
 * Показ витрины в настройке оформления рисует НАСТОЯЩИЕ экраны гостя, но
 * гостя за ними нет: оператор смотрит со стороны панели. Провайдер отдаёт то
 * же, что увидел бы зашедший «просто посмотреть» и ещё не представившийся:
 * сессии нет, заказывать нельзя, номера нет.
 *
 * `isReady: false` И `isPreview: true` — ДВА РАЗНЫХ ОТВЕТА НА ДВА РАЗНЫХ
 * ВОПРОСА, и путать их нельзя.
 *
 * «Готова ли сессия» — нет, и потому ни один гостевой запрос не уходит: они
 * все гейтятся этим флагом. Первая редакция подняла его, чтобы оболочка не
 * уводила на вход, — и витрина немедленно сходила в `/guest/orders/active`
 * без токена, получила 401 и выкинула оператора из панели.
 *
 * «Кто рисует витрину» — показ. По этому признаку оболочка соглашается
 * нарисовать экран без сессии, и только: больше он не влияет ни на что.
 *
 * Данные показу кладут в кэш серверной ручкой панели.
 *
 * Выдуманного номера и выдуманного гостя здесь нет и не будет: подменять
 * личность ради красивого показа — ровно то, от чего уходили.
 */
export function PreviewSessionProvider({
  hotel,
  currency,
  minorUnits,
  children,
}: {
  hotel: GuestHotel | null;
  currency: string;
  minorUnits: number;
  children: ReactNode;
}) {
  const value = useMemo<GuestSessionContextValue>(
    () => ({
      session: null,
      hotel,
      isBootstrapping: false,
      isReady: false,
      isPreview: true,
      canOrder: false,
      currency,
      minorUnits,
      start: () => Promise.reject(new Error('в показе сессия не заводится')),
      end: () => undefined,
    }),
    [hotel, currency, minorUnits],
  );
  return <GuestSessionContext.Provider value={value}>{children}</GuestSessionContext.Provider>;
}

export function useGuestSession(): GuestSessionContextValue {
  const ctx = useContext(GuestSessionContext);
  if (!ctx) throw new Error('useGuestSession must be used inside <GuestSessionProvider>');
  return ctx;
}

/**
 * То же самое, но БЕЗ отеля это не ошибка.
 *
 * Часть шапки живёт и на посадочной странице платформы, где отеля нет вовсе, —
 * там `null` штатное состояние, а не поломка провайдера.
 */
export function useOptionalGuestSession(): GuestSessionContextValue | null {
  return useContext(GuestSessionContext);
}
