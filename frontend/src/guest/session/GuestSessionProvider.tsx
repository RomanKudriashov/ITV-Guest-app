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

export function useGuestSession(): GuestSessionContextValue {
  const ctx = useContext(GuestSessionContext);
  if (!ctx) throw new Error('useGuestSession must be used inside <GuestSessionProvider>');
  return ctx;
}
