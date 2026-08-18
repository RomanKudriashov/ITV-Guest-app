/**
 * Thin typed fetch client for the CMS API.
 *
 * Contract essentials (docs/cms-api-contract.md):
 *  - base URL `/api/v1` (vite proxies it to the backend);
 *  - `Authorization: Bearer <jwt>` when a token is stored;
 *  - `X-Hotel-Subdomain` is sent on EVERY request (dev tenant resolution);
 *  - errors are parsed into `ApiError {status, code, detail, field}`;
 *  - a 401 clears the token and bounces to /login.
 */

// ЕДИНСТВЕННОЕ место, где задаётся версия API/WS. Весь фронт ходит через эти
// две константы — сменить версию или снять алиас можно правкой одной строки.
// Пути в вызовах остаются без версии (`/guest/...`), префикс добавляется здесь.
import { createSession } from '@/auth/session';

export const API_BASE = '/api/v1';
export const WS_BASE = '/ws/v1';

export const TOKEN_STORAGE_KEY = 'itv.cms.access';
export const REFRESH_STORAGE_KEY = 'itv.cms.refresh';

export const HOTEL_SUBDOMAIN: string =
  (import.meta.env.VITE_HOTEL_SUBDOMAIN as string | undefined) || 'crystal';

/**
 * Сессия CMS — на общем механизме (`auth/session`), том же, что у консоли
 * платформы. Раньше здесь лежала своя копия хранилища, а `refresh` копился в
 * localStorage без единого места, где его можно было бы предъявить.
 */
export const session = createSession({
  accessKey: TOKEN_STORAGE_KEY,
  refreshKey: REFRESH_STORAGE_KEY,
  refreshUrl: `${API_BASE}/staff/auth/refresh`,
  headers: () => ({ 'X-Hotel-Subdomain': HOTEL_SUBDOMAIN }),
  loginPath: '/login',
});

/** Прежнее имя — весь фронт зовёт его; за ним теперь общая сессия. */
export const tokenStorage = {
  get: (): string | null => session.access(),
  set: (access: string, refresh?: string) => session.set(access, refresh),
  clear: () => session.clear(),
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  /** Field the validation error belongs to (422 responses). */
  readonly field?: string;
  /** Full parsed body — extra keys such as `items_count` on 409. */
  readonly payload: Record<string, unknown>;

  constructor(
    status: number,
    detail: string,
    code = 'error',
    field?: string,
    payload: Record<string, unknown> = {},
  ) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.field = field;
    this.payload = payload;
  }

  get isValidation(): boolean {
    return this.status === 422;
  }
}

/** Called on 401 — wired by the auth provider so the client stays framework-free. */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
  // Тот же обработчик — и для сессии: пока приложение уводит на вход само,
  // жёсткий переход из `session.expire()` только оборвал бы его на полпути.
  session.onExpired(handler);
}

function defaultUnauthorized() {
  // Уход на вход живёт в общей сессии — вместе с поводом «сессия истекла».
  session.expire();
}

export interface RequestOptions {
  method?: string;
  /** JSON body — ignored when `formData` is given. */
  body?: unknown;
  formData?: FormData;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Extra headers merged on top of the defaults (e.g. `Accept-Language`). */
  headers?: Record<string, string>;
  /** Skip the 401 redirect (used by the login call itself). */
  skipAuthRedirect?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    search.append(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function toApiError(status: number, body: unknown): ApiError {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const detail =
      typeof record.detail === 'string'
        ? record.detail
        : typeof record.message === 'string'
          ? record.message
          : `HTTP ${status}`;
    const code = typeof record.code === 'string' ? record.code : `http_${status}`;
    const field = typeof record.field === 'string' ? record.field : undefined;
    return new ApiError(status, detail, code, field, record);
  }
  const detail = typeof body === 'string' && body ? body : `HTTP ${status}`;
  return new ApiError(status, detail, `http_${status}`);
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formData, query, signal, skipAuthRedirect } = options;

  let payload: BodyInit | undefined;
  const extraHeaders: Record<string, string> = {};
  if (formData) {
    // Let the browser set the multipart boundary.
    payload = formData;
  } else if (body !== undefined) {
    extraHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const send = (token: string | null) =>
    fetch(buildUrl(path, query), {
      method,
      headers: {
        Accept: 'application/json',
        // Dev tenant resolution — accepted by the backend only when DJANGO_DEBUG=1.
        'X-Hotel-Subdomain': HOTEL_SUBDOMAIN,
        ...extraHeaders,
        ...options.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: payload,
      signal,
    });

  // Упреждающее обновление: истекающий access меняется ДО запроса, чтобы
  // отказ не прилетал пользователю в момент нажатия. Логин и сам обмен сюда
  // не заходят — им обновлять нечего (`skipAuthRedirect`).
  let response = await send(skipAuthRedirect ? tokenStorage.get() : await session.accessForRequest());

  // Страховка. Сюда попадают только те, кого упреждение не спасло: часы
  // разъехались, токен отозвали, вкладка спала. Одно обновление, один повтор.
  if (response.status === 401 && !skipAuthRedirect) {
    const renewed = await session.refresh();
    if (renewed) response = await send(renewed);
  }

  const parsed = await parseBody(response);

  if (!response.ok) {
    // `expire()` и чистит, и ПОМЕЧАЕТ повод. Приложение уводит на вход своим
    // переходом (RequireAuth), в адресе флага не будет — метку прочтёт форма.
    if (response.status === 401 && !skipAuthRedirect) session.expire();
    throw toApiError(response.status, parsed);
  }

  return parsed as T;
}

/**
 * Скачивание файла ТЕМ ЖЕ путём, что и остальные запросы: с токеном.
 *
 * Голая ссылка (`<a href>`) сюда не годится — переход браузера не несёт
 * Authorization, сервер отвечает 401 с телом `{"detail":"Unauthorized"}`, и
 * браузер честно сохраняет этот JSON как «download.json». Файл при этом
 * целёхонек и лежит за тем же адресом — не хватало только заголовка.
 *
 * Имя берём из Content-Disposition: сервер знает и отель, и период, и тип
 * выгрузки. `fallback` — на случай ответа без заголовка.
 */
export async function requestFile(
  path: string,
  options: Omit<RequestOptions, 'method' | 'body' | 'formData'> & { fallbackName: string },
): Promise<{ blob: Blob; filename: string }> {
  const { query, signal, skipAuthRedirect, fallbackName } = options;

  const send = (token: string | null) =>
    fetch(buildUrl(path, query), {
      method: 'GET',
      headers: {
        'X-Hotel-Subdomain': HOTEL_SUBDOMAIN,
        ...options.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal,
    });

  // Тот же порядок, что у обычного запроса: упреждение, затем один повтор.
  // Выгрузка на десятки мегабайт легко переживает истечение часа.
  let response = await send(await session.accessForRequest());
  if (response.status === 401 && !skipAuthRedirect) {
    const renewed = await session.refresh();
    if (renewed) response = await send(renewed);
  }

  if (!response.ok) {
    if (response.status === 401 && !skipAuthRedirect) {
      if (unauthorizedHandler) unauthorizedHandler();
      else defaultUnauthorized();
    }
    throw toApiError(response.status, await parseBody(response));
  }

  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get('Content-Disposition')) ?? fallbackName,
  };
}

/** `attachment; filename="crystal-breakdown-last_30_days.csv"` → имя файла. */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  // RFC 5987 (`filename*=UTF-8''…`) идёт первым: он точнее и переживает кириллицу.
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      /* битую кодировку игнорируем и пробуем обычное filename */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
