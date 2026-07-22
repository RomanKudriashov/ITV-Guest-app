/**
 * Guest fetch client.
 *
 * Deliberately separate from `@/api/client` (the CMS one):
 *  - the guest bearer token lives under its OWN localStorage key, so a member of
 *    staff logged into the CMS in the same browser never leaks their JWT into a
 *    guest request and vice versa;
 *  - a 401 sends the guest back to the entry screen `/`, not to `/login`.
 *
 * Everything else follows the same contract as the CMS client: `/api` base,
 * `X-Hotel-Subdomain` on every request, errors parsed into `ApiError`.
 */

import { ApiError, API_BASE, HOTEL_SUBDOMAIN } from '@/api/client';

export const GUEST_TOKEN_KEY = 'itv.guest.token';
export const GUEST_SESSION_KEY = 'itv.guest.session_id';

export const guestTokenStorage = {
  get(): string | null {
    try {
      return window.localStorage.getItem(GUEST_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string, sessionId?: string) {
    try {
      window.localStorage.setItem(GUEST_TOKEN_KEY, token);
      if (sessionId) window.localStorage.setItem(GUEST_SESSION_KEY, sessionId);
    } catch {
      /* storage unavailable (private mode) */
    }
  },
  sessionId(): string | null {
    try {
      return window.localStorage.getItem(GUEST_SESSION_KEY);
    } catch {
      return null;
    }
  },
  clear() {
    try {
      window.localStorage.removeItem(GUEST_TOKEN_KEY);
      window.localStorage.removeItem(GUEST_SESSION_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

let guestUnauthorizedHandler: (() => void) | null = null;

export function setGuestUnauthorizedHandler(handler: (() => void) | null) {
  guestUnauthorizedHandler = handler;
}

function defaultGuestUnauthorized() {
  guestTokenStorage.clear();
  if (window.location.pathname !== '/') window.location.assign('/');
}

export interface GuestRequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Session creation runs without a token and must not bounce on 401/404. */
  skipAuthRedirect?: boolean;
}

function buildUrl(path: string, query?: GuestRequestOptions['query']): string {
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

/** Raised when fetch itself fails — no network, DNS, CORS. */
export class NetworkError extends Error {
  constructor(message = 'network_error') {
    super(message);
    this.name = 'NetworkError';
  }
}

export async function guestRequest<T>(
  path: string,
  options: GuestRequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, query, signal, skipAuthRedirect } = options;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Hotel-Subdomain': HOTEL_SUBDOMAIN,
    ...options.headers,
  };

  const token = guestTokenStorage.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), { method, headers, body: payload, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkError();
  }

  const parsed = await parseBody(response);

  if (!response.ok) {
    if (response.status === 401 && !skipAuthRedirect) {
      if (guestUnauthorizedHandler) guestUnauthorizedHandler();
      else defaultGuestUnauthorized();
    }
    throw toApiError(response.status, parsed);
  }

  return parsed as T;
}

export const guestApi = {
  get: <T>(path: string, options?: Omit<GuestRequestOptions, 'method' | 'body'>) =>
    guestRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(
    path: string,
    body?: unknown,
    options?: Omit<GuestRequestOptions, 'method' | 'body'>,
  ) => guestRequest<T>(path, { ...options, method: 'POST', body }),
};

/**
 * WS URL for the live order status. `hotel` is needed in dev (no proxy headers).
 *
 * The trailing slash is required: the ASGI router registers the route as
 * `ws/guest/order/<uuid:order_id>/` and Django matches it exactly.
 */
export function guestOrderSocketUrl(orderId: string, language?: string): string | null {
  const token = guestTokenStorage.get();
  if (!token) return null;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({ token, hotel: HOTEL_SUBDOMAIN });
  if (language) params.set('lang', language);
  return `${protocol}//${window.location.host}/ws/guest/order/${orderId}/?${params.toString()}`;
}

/**
 * WS URL for the guest chat thread. There is no id in the path: the socket
 * resolves the guest's own thread from the token (contract §3). The snapshot it
 * pushes has the same shape as `GET /api/guest/chat`.
 */
export function guestChatSocketUrl(language?: string): string | null {
  const token = guestTokenStorage.get();
  if (!token) return null;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({ token, hotel: HOTEL_SUBDOMAIN });
  if (language) params.set('lang', language);
  return `${protocol}//${window.location.host}/ws/guest/chat/?${params.toString()}`;
}
