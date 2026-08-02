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

import { setUnauthorizedHandler, tokenStorage } from '@/api/client';
import { fetchMe, login as loginRequest, normalizeMe } from '@/api/cms';
import type { HotelInfo, StaffUser } from '@/api/types';
import { useAppTheme } from '@/theme';

interface AuthContextValue {
  token: string | null;
  user: StaffUser | null;
  hotel: HotelInfo | null;
  /** True while the stored token is being validated on boot. */
  isBootstrapping: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // Бренд отеля персоналу. Провайдер темы смонтирован один раз в `main.tsx` без
  // токенов, и подставляла их раньше только гостевая сессия — поэтому CMS и
  // трекер работали на платформенном дефолте и открывались светлыми. Здесь та
  // же подстановка для персонала: точка одна, поверхностей — все.
  const { setBrandTokens } = useAppTheme();
  const [token, setToken] = useState<string | null>(() => tokenStorage.get());
  const [user, setUser] = useState<StaffUser | null>(null);
  const [hotel, setHotel] = useState<HotelInfo | null>(null);
  const [isBootstrapping, setBootstrapping] = useState<boolean>(() =>
    Boolean(tokenStorage.get()),
  );

  const logout = useCallback(() => {
    tokenStorage.clear();
    setToken(null);
    setUser(null);
    setHotel(null);
    queryClient.clear();
  }, [queryClient]);

  // The fetch client is framework-free; it calls back here on a 401.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      tokenStorage.clear();
      setToken(null);
      setUser(null);
      setHotel(null);
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Validate a token restored from localStorage.
  useEffect(() => {
    if (!token) {
      setBootstrapping(false);
      return;
    }
    if (user) return;

    let cancelled = false;
    setBootstrapping(true);
    fetchMe()
      .then((me) => {
        if (cancelled) return;
        setUser(normalizeMe(me));
        if (me.hotel) setHotel(me.hotel);
        if (me.theme) setBrandTokens(me.theme);
      })
      .catch(() => {
        if (!cancelled) logout();
      })
      .finally(() => {
        if (!cancelled) setBootstrapping(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, user, logout]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await loginRequest(email, password);
      tokenStorage.set(response.access, response.refresh);
      setToken(response.access);
      setUser(response.user);
      if (response.theme) setBrandTokens(response.theme);
    },
    [setBrandTokens],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      hotel,
      isBootstrapping,
      isAuthenticated: Boolean(token),
      login,
      logout,
    }),
    [token, user, hotel, isBootstrapping, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
