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
import {
  exchangeSupportCode,
  fetchMe,
  login as loginRequest,
  logoutHere,
  normalizeMe,
} from '@/api/cms';
import type { HotelInfo, StaffUser } from '@/api/types';
import { useAppTheme } from '@/theme';

interface AuthContextValue {
  token: string | null;
  user: StaffUser | null;
  hotel: HotelInfo | null;
  /** True while the stored token is being validated on boot. */
  isBootstrapping: boolean;
  isAuthenticated: boolean;
  /**
   * Возвращает вошедшего — с его правами.
   *
   * Раньше возвращала `void`, и экран входа считал посадку по `user` из
   * замыкания, то есть по состоянию ДО входа: там ещё `null`, и правило «есть
   * ли доступ в CMS» отвечало «нет» вообще всем.
   */
  login: (email: string, password: string) => Promise<StaffUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const CAPTURED_SUPPORT_CODE = takeSupportCode();

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // Бренд отеля персоналу. Провайдер темы смонтирован один раз в `main.tsx` без
  // токенов, и подставляла их раньше только гостевая сессия — поэтому CMS и
  // трекер работали на платформенном дефолте и открывались светлыми. Здесь та
  // же подстановка для персонала: точка одна, поверхностей — все.
  const { setBrandTokens } = useAppTheme();
  // Одноразовый код входа поддержки приходит в ХЭШ-ФРАГМЕНТЕ и вычищается из
  // адреса СРАЗУ, до первой отрисовки: фрагмент не уходит на сервер, но
  // остаётся в адресной строке и в истории вкладки, а там ему не место.
  const supportCode = CAPTURED_SUPPORT_CODE;
  const [token, setToken] = useState<string | null>(() => tokenStorage.get());
  const [user, setUser] = useState<StaffUser | null>(null);
  const [hotel, setHotel] = useState<HotelInfo | null>(null);
  // Код входа поддержки считается загрузкой С ПЕРВОГО РЕНДЕРА, а не с момента,
  // когда эффект обмена успеет отработать. Эффекты идут ПОСЛЕ отрисовки, и
  // охрана маршрута — «токена нет, грузиться нечему» — успевала увести вкладку
  // на /login раньше, чем код вообще уходил на обмен.
  const [isBootstrapping, setBootstrapping] = useState<boolean>(
    () => Boolean(tokenStorage.get()) || Boolean(supportCode),
  );

  const logout = useCallback(() => {
    // Сначала рвём сессию НА СЕРВЕРЕ, потом чистим браузер. Без первого
    // «выйти» означало только «забыть токены здесь»: копия refresh, снятая
    // заранее, работала бы ещё неделю.
    //
    // Ответа не ждём и отказ проглатываем: выйти человек должен и без сети.
    // Серверная строка в этом случае доживёт свой срок сама.
    void logoutHere().catch(() => undefined);
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

  // Обмен одноразового кода на токен. Идёт ПЕРВЫМ: пока он не завершён,
  // остальная загрузка ждёт, иначе экран успеет уехать на /login.
  useEffect(() => {
    if (!supportCode) return;
    setBootstrapping(true);
    void (async () => {
      try {
        const granted = await exchangeSupportCode(supportCode);
        tokenStorage.set(granted.access);
        setToken(granted.access);
      } catch {
        // Код одноразовый и живёт минуту. Не подошёл — обычный вход.
        setBootstrapping(false);
      }
    })();
  }, [supportCode]);

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
      return response.user;
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

/**
 * Забрать код входа поддержки из хэша и стереть его из адреса.
 *
 * Именно из хэша: строка запроса уезжает на сервер и оседает в логах прокси
 * и в заголовке `Referer`, а фрагмент — нет. `replaceState` убирает его и из
 * истории вкладки, так что после обмена в адресе не остаётся ничего.
 */
/**
 * Код забирается ОДИН раз на загрузку страницы, а не в инициализаторе
 * состояния.
 *
 * В инициализаторе он и стоял — и не работал: React в StrictMode вызывает
 * инициализатор дважды, а вычистка адреса внутри — побочное действие. Первый
 * вызов стирал хэш, второй возвращал null, и его-то React и оставлял. Обмен
 * не начинался вовсе, вкладка поддержки уезжала на страницу входа.
 */
function takeSupportCode(): string | null {
  if (typeof window === 'undefined') return null;
  const match = /(?:^|[#&])support=([^&]+)/.exec(window.location.hash || '');
  if (!match) return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return decodeURIComponent(match[1]);
}
