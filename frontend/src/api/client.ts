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
export const API_BASE = '/api/v1';
export const WS_BASE = '/ws/v1';

export const TOKEN_STORAGE_KEY = 'itv.cms.access';
export const REFRESH_STORAGE_KEY = 'itv.cms.refresh';

export const HOTEL_SUBDOMAIN: string =
  (import.meta.env.VITE_HOTEL_SUBDOMAIN as string | undefined) || 'crystal';

export const tokenStorage = {
  get(): string | null {
    try {
      return window.localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  },
  set(access: string, refresh?: string) {
    try {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, access);
      if (refresh) window.localStorage.setItem(REFRESH_STORAGE_KEY, refresh);
    } catch {
      /* storage unavailable */
    }
  },
  clear() {
    try {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(REFRESH_STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  },
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
}

function defaultUnauthorized() {
  tokenStorage.clear();
  if (window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
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

  const headers: Record<string, string> = {
    Accept: 'application/json',
    // Dev tenant resolution — accepted by the backend only when DJANGO_DEBUG=1.
    'X-Hotel-Subdomain': HOTEL_SUBDOMAIN,
    ...options.headers,
  };

  const token = tokenStorage.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (formData) {
    // Let the browser set the multipart boundary.
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: payload,
    signal,
  });

  const parsed = await parseBody(response);

  if (!response.ok) {
    if (response.status === 401 && !skipAuthRedirect) {
      if (unauthorizedHandler) unauthorizedHandler();
      else defaultUnauthorized();
    }
    throw toApiError(response.status, parsed);
  }

  return parsed as T;
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
