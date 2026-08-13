/**
 * Клиент корневой админки. Работает на БАЗОВОМ домене и НЕ шлёт
 * `X-Hotel-Subdomain` — платформа вне тенанта. Токен хранится отдельно от
 * CMS-токена, чтобы области не путались.
 *
 * Путь API остался `/api/v1/platform`: переименован адрес ИНТЕРФЕЙСА
 * (/platform → /admin), а не контракт. Ломать опубликованный контракт ради
 * симметрии названий — платить совместимостью за косметику.
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
  tariff?: string;
  offboarding?: OffboardState | null;
}

export interface CreateHotelInput {
  subdomain: string;
  name: string;
  admin_email: string;
  template?: string | null;
  timezone?: string;
  currency?: string;
  languages?: string[];
  preset?: string;
}

export interface CreateHotelResult {
  hotel: HotelProfile;
  // Пароля здесь нет: он уходит письмом администратору отеля.
  admin: { email: string; delivered_to: string; sent_at: string };
  template: string | null;
  services: string[];
}

export interface PlatformMe {
  id: string;
  email: string;
  full_name: string;
  role: 'owner' | 'support' | 'read_only';
  totp_enabled: boolean;
}

/**
 * Вход. Второй фактор приходит ВТОРЫМ шагом: первый вызов отвечает
 * `mfa_required`, и только тогда UI спрашивает код. Спрашивать его сразу у
 * всех значило бы показывать поле тем, у кого 2FA не заведена.
 */
export async function platformLogin(
  email: string,
  password: string,
  totpCode?: string,
): Promise<void> {
  const data = await request<{ access: string }>('/auth/login', 'POST', {
    email,
    password,
    totp_code: totpCode || null,
  });
  platformToken.set(data.access);
}

export const getMe = () => request<PlatformMe>('/auth/me');
export const totpSetup = () =>
  request<{ secret: string; otpauth_url: string }>('/auth/2fa/setup', 'POST');
export async function totpEnable(code: string): Promise<void> {
  // Ответ несёт НОВЫЙ токен: прежний выписан до включения 2FA и перестал
  // действовать. Без подмены включивший 2FA выкинул бы сам себя.
  const data = await request<{ access: string }>('/auth/2fa/enable', 'POST', { code });
  platformToken.set(data.access);
}
export const totpDisable = () => request<{ ok: boolean }>('/auth/2fa/disable', 'POST');

export const listHotels = () => request<HotelBrief[]>('/hotels');
export const getHotel = (id: string) => request<HotelProfile>(`/hotels/${id}`);
export const createHotel = (body: CreateHotelInput) =>
  request<CreateHotelResult>('/hotels', 'POST', body);
export const patchHotel = (id: string, body: Partial<HotelProfile>) =>
  request<HotelProfile>(`/hotels/${id}`, 'PATCH', body);
export const setHotelAdmin = (id: string, body: { email: string }) =>
  request<{ email: string; delivered_to: string; sent_at: string }>(
    `/hotels/${id}/admins`, 'POST', body);

// Смена адреса администратора: выход из «отель потерял и почту тоже».
// Право владельца, письма не шлёт — старый ящик и есть то, что потеряно.
export const changeHotelAdminEmail = (
  id: string,
  body: { current_email: string; new_email: string },
) => request<{ email: string; previous_email: string }>(
  `/hotels/${id}/admins/email`, 'PUT', body);

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

/* ── Сводка по платформе ────────────────────────────────────────────────── */

export interface OverviewHealth {
  level: 'ok' | 'warn' | 'bad';
  code: string;
  count?: number;
  hotel?: string;
  subdomain?: string;
  days?: number | null;
  purpose?: string;
  seconds?: number | null;
}

export interface TariffBrief {
  code: string;
  title: Record<string, string>;
  modules: string[];
  limits: { services: number | null; rooms: number | null; staff: number | null };
  is_trial: boolean;
  hotels: number;
}

export interface PlatformOverview {
  hotels: { total: number; active: number; trial: number; disabled: number };
  orders_today: number;
  gross_today: { currency: string; minor: number }[];
  live_sessions: number;
  growth: { month: string; hotels: number }[];
  health: OverviewHealth[];
  tariffs: TariffBrief[];
}

export const getOverview = () => request<PlatformOverview>('/overview');

/* ── Флот ───────────────────────────────────────────────────────────────── */

export interface FleetRow {
  id: string;
  name: string;
  subdomain: string;
  is_active: boolean;
  origin: 'live' | 'demo' | 'test';
  status: 'active' | 'trial' | 'disabled';
  tariff: string;
  tariff_title: Record<string, string>;
  trial_days_left: number | null;
  created_at: string;
  counts: { rooms: number; staff: number; items: number; services: number; orders_7d: number };
  node_offline: boolean;
}

export interface FleetQuery {
  search?: string;
  status?: '' | 'active' | 'trial' | 'disabled';
  tariff?: string;
  origin?: 'live' | 'demo' | 'test' | 'all';
  sort?: string;
  page?: number;
  page_size?: number;
}

export interface FleetPage {
  items: FleetRow[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  facets: { all: number; active: number; trial: number; disabled: number };
}

function fleetQuery(query: FleetQuery): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const getFleet = (query: FleetQuery) => request<FleetPage>(`/fleet${fleetQuery(query)}`);

export const bulkSetActive = (hotelIds: string[], isActive: boolean) =>
  request<{ changed: number; requested: number }>('/fleet/bulk', 'POST', {
    hotel_ids: hotelIds,
    is_active: isActive,
  });

/**
 * Выгрузка. Идёт мимо `request`: ответ — CSV, а не JSON, и его нужно отдать
 * браузеру файлом, а не разобрать.
 */
export async function downloadFleetCsv(query: FleetQuery): Promise<void> {
  const token = platformToken.get();
  const res = await fetch(`${BASE}/fleet/export${fleetQuery(query)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new PlatformError(res.status, `Ошибка ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'fleet.csv';
  link.click();
  URL.revokeObjectURL(url);
}

/* ── Карточка отеля ─────────────────────────────────────────────────────── */

export interface UsageRow {
  key: 'services' | 'rooms' | 'staff';
  used: number;
  limit: number | null;
  ratio: number | null;
  over: boolean;
}

export interface HotelUsage {
  tariff: string;
  tariff_title: Record<string, string>;
  is_trial: boolean;
  trial_ends_at: string | null;
  trial_days_left: number | null;
  tariff_started_on: string | null;
  rows: UsageRow[];
}

export interface ActivityRow {
  id: string;
  at: string;
  actor_type: string;
  actor_id: string | null;
  impersonated_by: string | null;
  action: string;
  object_type: string;
  payload: Record<string, unknown>;
}

export interface ModuleEntry {
  code: string;
  title: Record<string, string>;
  is_enabled: boolean;
  source: 'tariff' | 'override';
  config: Record<string, unknown>;
}

export interface DowngradeWarning {
  key: string;
  used?: number;
  limit?: number;
  modules?: string[];
}

export const getUsage = (id: string) => request<HotelUsage>(`/hotels/${id}/usage`);
export const getActivity = (id: string) => request<ActivityRow[]>(`/hotels/${id}/activity`);
export const getModules = (id: string) =>
  request<{ tariff: string; modules: ModuleEntry[] }>(`/hotels/${id}/modules`);
// Тариф этой ручкой НЕ передаётся: у него одна дверь — `setTariff` ниже,
// запертая на владельца. Параметр здесь был, вызывающих не имел, но держал
// лазейку открытой на сервере.
export const putModules = (id: string, modules: ModuleEntry[]) =>
  request<{ tariff: string; modules: ModuleEntry[] }>(`/hotels/${id}/modules`, 'PUT', {
    modules: modules.map((m) => ({
      code: m.code,
      is_enabled: m.is_enabled,
      source: m.source,
      config: m.config,
    })),
  });
export const setTariff = (
  id: string,
  body: { tariff: string; trial_ends_at?: string | null; acknowledge_downgrade?: boolean },
) =>
  request<{ ok: boolean; warnings: DowngradeWarning[]; code?: string }>(`/hotels/${id}/tariff`, 'PUT', body);

/* ── Тарифы, узлы, команда, аудит, вход в отель ─────────────────────────── */

export interface TariffRow {
  code: string;
  title: Record<string, string>;
  modules: string[];
  limits: { services: number | null; rooms: number | null; staff: number | null };
  is_trial: boolean;
  trial_days: number;
  hotels: number;
}

export interface NodeRow {
  id: string;
  hotel: string;
  hotel_id: string;
  subdomain: string;
  name: string;
  purpose: 'grms' | 'pms' | 'both';
  is_registered: boolean;
  is_online: boolean;
  is_revoked: boolean;
  seconds_since_seen: number | null;
  last_seen_at: string | null;
  key_issued_at: string | null;
  version: string;
}

export interface TeamMember {
  id: string;
  email: string;
  full_name: string;
  role: 'owner' | 'support' | 'read_only';
  is_active: boolean;
  totp_enabled: boolean;
}

export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  action: string;
  hotel: string | null;
  subdomain: string | null;
  payload: Record<string, unknown>;
}

export interface EnterResult {
  // Токена здесь НЕТ: наружу уходит одноразовый код, который CMS меняет на
  // токен со своей стороны. Токен в адресной строке пережил бы сессию —
  // он остаётся в истории браузера, в `Referer` и в логах прокси.
  code: string;
  code_expires_at: string;
  grant_id: string;
  expires_at: string;
  ttl_minutes: number;
  as_user: string;
  cms_url: string;
  subdomain: string;
}

export interface ImpersonationRow {
  id: string;
  hotel_id: string;
  hotel: string;
  subdomain: string;
  actor: string;
  as_user: string;
  reason: string;
  started_at: string;
  expires_at: string;
  entered: boolean;
}

export const getImpersonations = () => request<ImpersonationRow[]>('/impersonations');
export const revokeImpersonation = (id: string) =>
  request<{ grant_id: string; revoked_at: string }>(`/impersonations/${id}/revoke`, 'POST');

export const getTariffs = () => request<TariffRow[]>('/tariffs');
export const getNodes = () => request<NodeRow[]>('/nodes');
export const createNode = (hotelId: string, body: { name: string; purpose: string }) =>
  request<{ node: NodeRow; key: string }>(`/hotels/${hotelId}/nodes`, 'POST', body);
export const revokeNode = (id: string) => request<NodeRow>(`/nodes/${id}/revoke`, 'POST');
export const reissueNode = (id: string) =>
  request<{ node: NodeRow; key: string }>(`/nodes/${id}/reissue`, 'POST');

export const getTeam = () => request<TeamMember[]>('/team');
export const inviteMember = (body: { email: string; role: string; full_name?: string }) =>
  request<{ member: TeamMember; password: string }>('/team', 'POST', body);
export const patchMember = (id: string, body: { role?: string; is_active?: boolean }) =>
  request<TeamMember>(`/team/${id}`, 'PATCH', body);

export const getAudit = (limit = 100) => request<AuditRow[]>(`/audit?limit=${limit}`);

export const enterHotel = (id: string, body: { reason: string; ttl_minutes: number }) =>
  request<EnterResult>(`/hotels/${id}/enter`, 'POST', body);

/* ── Шаблоны онбординга и системный справочник ──────────────────────────── */

export interface OnboardingTemplate {
  id: string;
  code: string;
  title: Record<string, string>;
  description: Record<string, string>;
  tariff: string;
  services: { type: string; name: Record<string, string> }[];
  modules: string[];
  languages: string[];
  preset: string;
  is_active: boolean;
  sort_order: number;
}

export interface DictionaryEntry {
  id: string;
  kind: 'allergen' | 'marker';
  code: string;
  title: Record<string, string>;
  is_active: boolean;
  sort_order: number;
}

export const getTemplates = () => request<OnboardingTemplate[]>('/templates');
export const patchTemplate = (id: string, body: Partial<OnboardingTemplate>) =>
  request<OnboardingTemplate>(`/templates/${id}`, 'PATCH', body);
export const getDictionary = () => request<DictionaryEntry[]>('/dictionaries');
export const putDictionaryEntry = (body: {
  kind: string;
  code: string;
  title: Record<string, string>;
  is_active?: boolean;
}) => request<DictionaryEntry>('/dictionaries', 'PUT', body);

/* ── Экспорт и офбординг ────────────────────────────────────────────────── */

export interface OffboardState {
  marked_at: string;
  marked_by: string;
  reason: string;
  purged_at?: string;
  removed?: Record<string, number>;
}

export const markOffboarding = (id: string, reason: string) =>
  request<{ marked: OffboardState | null }>(`/hotels/${id}/offboard`, 'POST', { reason });
export const cancelOffboarding = (id: string) =>
  request<{ marked: null }>(`/hotels/${id}/offboard`, 'POST', { cancel: true });
export const purgeHotel = (id: string, confirmSubdomain: string) =>
  request<{ removed: Record<string, number>; purged_on: string }>(`/hotels/${id}/purge`, 'POST', {
    confirm_subdomain: confirmSubdomain,
  });

/** Выгрузка отеля файлом: ответ — JSON-документ, а не данные для экрана. */
export async function downloadHotelExport(id: string, subdomain: string): Promise<void> {
  const token = platformToken.get();
  const res = await fetch(`${BASE}/hotels/${id}/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new PlatformError(res.status, `Ошибка ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${subdomain}-export.json`;
  link.click();
  URL.revokeObjectURL(url);
}
