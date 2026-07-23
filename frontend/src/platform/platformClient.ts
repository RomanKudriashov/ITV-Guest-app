/**
 * Клиент платформенной консоли. Работает на БАЗОВОМ домене и НЕ шлёт
 * `X-Hotel-Subdomain` — платформа вне тенанта. Токен хранится отдельно от
 * CMS-токена, чтобы области не путались.
 */

const BASE = '/api/v1/platform';
const TOKEN_KEY = 'itv.platform.access';

export const platformToken = {
  get(): string | null {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(value: string): void {
    try {
      window.localStorage.setItem(TOKEN_KEY, value);
    } catch {
      /* private mode */
    }
  },
  clear(): void {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class PlatformError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = platformToken.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (data && (data.detail as string)) || `Ошибка ${res.status}`;
    throw new PlatformError(res.status, detail, data?.code);
  }
  return data as T;
}

export interface HotelCounts {
  rooms: number;
  staff: number;
  items: number;
}

export interface HotelBrief {
  id: string;
  name: string;
  subdomain: string;
  is_active: boolean;
  created_at: string;
  counts: HotelCounts;
}

export interface HotelLanguageBrief {
  code: string;
  title: string;
  is_default: boolean;
}

export interface HotelProfile extends HotelBrief {
  timezone: string;
  currency: string;
  default_language: string;
  languages: HotelLanguageBrief[];
}

export interface CreateHotelInput {
  subdomain: string;
  name: string;
  admin_email: string;
  timezone?: string;
  currency?: string;
  languages?: string[];
  preset?: string;
  admin_password?: string | null;
}

export interface CreateHotelResult {
  hotel: HotelProfile;
  admin: { email: string; password: string | null };
}

export async function platformLogin(email: string, password: string): Promise<void> {
  const data = await request<{ access: string }>('/auth/login', 'POST', { email, password });
  platformToken.set(data.access);
}

export const listHotels = () => request<HotelBrief[]>('/hotels');
export const getHotel = (id: string) => request<HotelProfile>(`/hotels/${id}`);
export const createHotel = (body: CreateHotelInput) =>
  request<CreateHotelResult>('/hotels', 'POST', body);
export const patchHotel = (id: string, body: Partial<HotelProfile>) =>
  request<HotelProfile>(`/hotels/${id}`, 'PATCH', body);
export const setHotelAdmin = (id: string, body: { email: string; password?: string }) =>
  request<{ email: string; password: string }>(`/hotels/${id}/admins`, 'POST', body);

export const BRAND_PRESETS = [
  'midnight_navy',
  'sapphire_dark',
  'evening_concierge',
  'tiffany_night',
  'harbor_light',
  'porcelain_navy',
  'azure_light',
  'marble_linen',
];
