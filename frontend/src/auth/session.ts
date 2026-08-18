/**
 * Жизнь сессии персонала: один механизм на консоль платформы и на CMS отеля.
 *
 * Было два разных: CMS хранила refresh и никогда им не пользовалась (обменять
 * его было НЕ НА ЧТО — ручки обновления не существовало вовсе), а консоль
 * refresh с логина просто выбрасывала и на 401 не делала ничего — экран
 * оставался жить и копить отказы. Здесь обе области ходят через один код,
 * различаясь только адресами и ключами хранения.
 *
 * Правила:
 *   * access обновляется УПРЕЖДАЮЩЕ, за минуту до истечения, — чтобы отказ не
 *     прилетал пользователю в момент нажатия;
 *   * 401 — страховка, а не основной путь: одно обновление и один повтор;
 *   * обновление ОДНО на все параллельные запросы: остальные ждут его, а не
 *     заводят своё (иначе десять вкладок дают десять обменов, и выигравший
 *     последним затирает refresh, которым уже воспользовались);
 *   * вместе с access приходит новый refresh — активность продлевает сессию.
 */

export interface SessionScope {
  /** Ключи localStorage. Области не пересекаются намеренно. */
  accessKey: string;
  refreshKey: string;
  /** Полный путь ручки обновления. */
  refreshUrl: string;
  /** Заголовки, без которых ручка не отвечает (тенант у CMS). */
  headers?: () => Record<string, string>;
  /** Куда уводить, когда обновить не удалось. */
  loginPath: string;
}

/** Секунд до истечения, на которых пора обновляться, не дожидаясь отказа. */
const REFRESH_MARGIN_SECONDS = 60;

export function createSession(scope: SessionScope) {
  /** Одно обновление на всех: сюда складывается летящий обмен. */
  let inFlight: Promise<string | null> | null = null;
  let expiredHandler: (() => void) | null = null;

  const read = (key: string): string | null => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const store = {
    access: () => read(scope.accessKey),
    refresh: () => read(scope.refreshKey),
    set(access: string, refresh?: string) {
      try {
        window.localStorage.setItem(scope.accessKey, access);
        if (refresh) window.localStorage.setItem(scope.refreshKey, refresh);
      } catch {
        /* приватный режим — работаем на время вкладки */
      }
      // Новые токены — сессия снова жива, повода больше нет.
      clearExpired();
    },
    clear() {
      try {
        window.localStorage.removeItem(scope.accessKey);
        window.localStorage.removeItem(scope.refreshKey);
      } catch {
        /* ignore */
      }
    },
  };

  /** Срок из полезной нагрузки JWT. Подпись здесь не проверяется — это делает сервер. */
  function expiresAt(token: string | null): number | null {
    if (!token) return null;
    const part = token.split('.')[1];
    if (!part) return null;
    try {
      const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
      const exp = (JSON.parse(json) as { exp?: number }).exp;
      return typeof exp === 'number' ? exp * 1000 : null;
    } catch {
      return null;
    }
  }

  /** Пора ли обновляться: срока нет, он вышел или выйдет в ближайшую минуту. */
  function isStale(token: string | null): boolean {
    const at = expiresAt(token);
    if (at === null) return false;
    return at - Date.now() <= REFRESH_MARGIN_SECONDS * 1000;
  }

  /**
   * Обменять refresh на новую пару. Возвращает новый access или null.
   * Повторный вызов, пока обмен летит, отдаёт ТОТ ЖЕ промис.
   */
  function refresh(): Promise<string | null> {
    if (inFlight) return inFlight;

    const token = store.refresh();
    if (!token) {
      // Нечего обменивать — сессии нет, и притворяться незачем.
      return Promise.resolve(null);
    }

    inFlight = fetch(scope.refreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(scope.headers?.() ?? {}) },
      body: JSON.stringify({ refresh: token }),
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = (await response.json()) as { access?: string; refresh?: string };
        if (!data.access) return null;
        store.set(data.access, data.refresh);
        return data.access;
      })
      .catch(() => null)
      .finally(() => {
        // Снимаем ПОСЛЕ разрешения: пока промис висит, все ждут его.
        inFlight = null;
      });

    return inFlight;
  }

  /** Обновить, если срок на исходе. Возвращает токен, с которым идти дальше. */
  async function accessForRequest(): Promise<string | null> {
    const current = store.access();
    if (current && isStale(current)) {
      const renewed = await refresh();
      // Не вышло — идём со старым: пусть откажет сервер, а не мы сами.
      return renewed ?? store.access();
    }
    return current;
  }

  /**
   * Сессия кончилась: чистим и уводим на вход с внятным поводом.
   *
   * Повод помечается ОТДЕЛЬНО от адреса. Приложение может увести на вход своим
   * переходом (у CMS так и есть: свой обработчик 401 + `RequireAuth`), и тогда
   * никакого `?expired=1` в адресе не появится — метка переживает и этот путь.
   */
  function expire() {
    store.clear();
    markExpired();
    if (expiredHandler) {
      expiredHandler();
      return;
    }
    if (typeof window === 'undefined') return;
    if (window.location.pathname === scope.loginPath) return;
    window.location.assign(`${scope.loginPath}?expired=1`);
  }

  const EXPIRED_MARK = `${scope.accessKey}.expired`;

  function markExpired() {
    try {
      window.sessionStorage.setItem(EXPIRED_MARK, '1');
    } catch {
      /* ignore */
    }
  }

  /**
   * Умерла ли сессия. Чтение ЧИСТОЕ — метку снимает успешный вход, а не взгляд
   * на неё.
   *
   * Соблазнительное «прочитал и стёр» здесь ломается дважды. Во-первых, React
   * в StrictMode зовёт инициализатор `useState` ДВАЖДЫ, и первый вызов съедал
   * бы метку для второго — эта яма в коде уже зафиксирована (`takeSupportCode`).
   * Во-вторых, и это хуже: форма входа монтируется не в предсказуемый момент, и
   * гонка «кто первый спросил» делала сообщение то видимым, то нет — ровно тот
   * плавающий отказ, который потом ищут неделю.
   *
   * Чистое чтение убирает обе: сколько угодно раз, кем угодно, в любом порядке.
   */
  function hasExpired(): boolean {
    try {
      return Boolean(
        new URLSearchParams(window.location.search).get('expired') ||
          window.sessionStorage.getItem(EXPIRED_MARK),
      );
    } catch {
      return false;
    }
  }

  function clearExpired() {
    try {
      window.sessionStorage.removeItem(EXPIRED_MARK);
    } catch {
      /* ignore */
    }
  }

  return {
    ...store,
    refresh,
    accessForRequest,
    isStale,
    expiresAt,
    expire,
    hasExpired,
    clearExpired,
    /** Тесты и провайдер подменяют уход на вход своим переходом. */
    onExpired(handler: (() => void) | null) {
      expiredHandler = handler;
    },
  };
}

export type Session = ReturnType<typeof createSession>;
