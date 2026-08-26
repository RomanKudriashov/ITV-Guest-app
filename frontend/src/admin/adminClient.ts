/**
 * Клиент корневой админки. Работает на БАЗОВОМ домене и НЕ шлёт
 * `X-Hotel-Subdomain` — платформа вне тенанта. Токен хранится отдельно от
 * CMS-токена, чтобы области не путались.
 *
 * Путь API остался `/api/v1/platform`: переименован адрес ИНТЕРФЕЙСА
 * (/platform → /admin), а не контракт. Ломать опубликованный контракт ради
 * симметрии названий — платить совместимостью за косметику.
 */

import { createSession } from "@/auth/session";
import { i18n } from "@/i18n";

/**
 * Человеческий текст отказа.
 *
 * Здесь стояло `Ошибка ${res.status}`, и оператор консоли читал «Ошибка 502» —
 * строку, которая не говорит ни что случилось, ни что делать, и вдобавок
 * существует только по-русски, хотя консоль переключает язык вместе с CMS.
 *
 * Текст сервера, если он есть, ВСЕГДА в приоритете: бэкенд объясняет отказ
 * по делу («поддомен занят», «нет прав на это действие»), и заменять его общей
 * фразой значит терять единственное осмысленное объяснение. Свой текст —
 * только когда сервер промолчал.
 *
 * Сам код НЕ выброшен: он уезжает в `PlatformError.status`, по нему работают
 * ветвления (401 гасит сессию) и он виден в консоли разработчика.
 */
function humanError(status: number): string {
  if (status === 403) return i18n.t("admin.errors.forbidden");
  if (status === 0) return i18n.t("admin.errors.network");
  return i18n.t("admin.errors.http");
}

const BASE = "/api/v1/platform";
const TOKEN_KEY = 'itv.platform.access';
const REFRESH_KEY = 'itv.platform.refresh';

/**
 * Сессия консоли — на ОБЩЕМ механизме с CMS отеля (`auth/session`).
 *
 * Раньше здесь была своя половинка: `set(value)` брала один аргумент, поэтому
 * refresh, который сервер честно выдавал на логине, выбрасывался прямо в
 * точке получения. А на 401 клиент просто бросал ошибку — ни чистки, ни
 * ухода на вход: экран оставался жить и копить отказы. Это и был мёртвый
 * интерфейс.
 */
export const platformSession = createSession({
  accessKey: TOKEN_KEY,
  refreshKey: REFRESH_KEY,
  refreshUrl: `${BASE}/auth/refresh`,
  loginPath: '/admin',
});

export const platformToken = {
  get: (): string | null => platformSession.access(),
  set: (access: string, refresh?: string): void => platformSession.set(access, refresh),
  clear: (): void => platformSession.clear(),
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

/**
 * Запрос платформенным подключением — наружу, для экранов, которые живут в
 * обеих консолях.
 *
 * Конфигурация управления номером переехала в `/admin`, но экраны у неё те же,
 * что были в CMS. Различаются они не только путём: у консоли своё хранилище
 * токенов, свой обмен и свой вход. Подмешивать платформенный токен в клиент
 * CMS значило бы сцепить две авторизации в одну — и однажды увести оператора
 * на вход отеля.
 */
export function platformRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  return request<T>(path, method, body);
}

/**
 * Загрузка файла платформенным подключением: multipart, а не JSON.
 *
 * Токен берётся ТЕМ ЖЕ путём, что у обычных запросов, — через сессию с
 * упреждающим обменом. Первая редакция читала хранилище напрямую и на
 * протухшем токене молча получала 401: экран оставался без кадра, ошибки
 * никакой, и выглядело это как «загрузка не сработала».
 */
export async function platformUpload<T>(path: string, form: FormData): Promise<T> {
  const send = (token: string | null) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });

  let res = await send(await platformSession.accessForRequest());
  if (res.status === 401) {
    const renewed = await platformSession.refresh();
    if (renewed) res = await send(renewed);
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) platformSession.expire();
    const detail = (data && (data.detail as string)) || humanError(res.status);
    throw new PlatformError(res.status, detail, data?.code);
  }
  return data as T;
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const send = (token: string | null) =>
    fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  // Логин и обмен ходят без сессии: обновлять им нечего, а упреждающий обмен
  // на странице входа отправил бы в никуда.
  const anonymous = path === '/auth/login' || path === '/auth/refresh';

  let res = await send(anonymous ? null : await platformSession.accessForRequest());
  if (res.status === 401 && !anonymous) {
    const renewed = await platformSession.refresh();
    if (renewed) res = await send(renewed);
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    // 401 после обновления — сессии больше нет. Уводим на вход с поводом,
    // а не оставляем экран собирать отказы.
    if (res.status === 401 && !anonymous) platformSession.expire();
    const detail = (data && (data.detail as string)) || humanError(res.status);
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
  /** Город строкой на языке отеля: по нему режет флот группа-правило. */
  city?: string;
  timezone: string;
  currency: string;
  /** Знаков после запятой у валюты: 2 — рубль, 0 — иена. */
  currency_minor_units: number;
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
  const data = await request<{ access: string; refresh?: string }>('/auth/login', 'POST', {
    email,
    password,
    totp_code: totpCode || null,
  });
  // Refresh СОХРАНЯЕМ. Раньше он тут терялся: `set` брала один аргумент, и
  // недельная сессия жила ровно час — до первого истечения access.
  platformToken.set(data.access, data.refresh);
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

/* ── Сессии консоли ─────────────────────────────────────────────────────── */

export interface PlatformSessionRow {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string;
  ip: string | null;
  is_current: boolean;
}

export const listSessions = () => request<PlatformSessionRow[]>('/auth/sessions');
export const closeSession = (id: string) => request<{ ok: boolean }>(`/auth/sessions/${id}`, 'DELETE');
export const platformLogoutHere = () => request<{ ok: boolean }>('/auth/logout', 'POST');
export const platformLogoutEverywhere = () =>
  request<{ ok: boolean; closed: number }>('/auth/logout-all', 'POST');

/**
 * Выдачи консоли приходят ОБОЛОЧКОЙ, а не голым списком.
 *
 * `total` рядом с `items` — не украшение: список с пределом, отданный как
 * массив, выглядит полным, и оператор уверен, что узлов ровно двадцать пять.
 * `truncated` говорит интерфейсу, когда сказать «показаны первые N из M».
 */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  truncated: boolean;
}

export const listHotels = (limit = 100) => request<Page<HotelBrief>>(`/hotels?limit=${limit}`);
export const getHotel = (id: string) => request<HotelProfile>(`/hotels/${id}`);
export const createHotel = (body: CreateHotelInput) =>
  request<CreateHotelResult>('/hotels', 'POST', body);
export interface HotelPatch {
  name?: string;
  /** Город — переводимое поле, поэтому словарь: `{ru: "Москва"}`. */
  city?: Record<string, string>;
  timezone?: string;
  currency?: string;
  currency_minor_units?: number;
  languages?: string[];
  is_active?: boolean;
}

export const patchHotel = (id: string, body: HotelPatch | Partial<HotelProfile>) =>
  request<HotelProfile>(`/hotels/${id}`, 'PATCH', body);
export const setHotelAdmin = (id: string, body: { email: string }) =>
  request<{
    email: string;
    delivered_to: string;
    sent_at: string;
    /** Кто уже был админом до этого. Непусто — заводится ВТОРОЙ. */
    existing_admins?: string[];
  }>(`/hotels/${id}/admins`, 'POST', body);

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
  /** Группа отелей: у правила состав считает сервер в момент запроса. */
  group?: string;
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

/**
 * Массовое включение/выключение. Адресация ДВУМЯ способами: перечнем отелей и
 * группой. Состав группы клиент не считает — у правила он вычисляемый, и
 * посчитанный здесь разошёлся бы с тем, к чему применилось на сервере.
 */
export const bulkSetActive = (hotelIds: string[], isActive: boolean, groupId?: string) =>
  request<{ changed: number; requested: number }>('/fleet/bulk', 'POST', {
    hotel_ids: hotelIds,
    is_active: isActive,
    group_id: groupId ?? null,
  });

/* ── Группы отелей ─────────────────────────────────────────────────────── */

export interface HotelGroup {
  id: string;
  code: string;
  title: string;
  kind: string;
  mode: 'list' | 'rule';
  rule: Record<string, string>;
  note: string;
  created_at: string;
  /** Размер считает сервер: у правила он вычисляемый. */
  size?: number;
}

export interface GroupMember {
  hotel_id: string;
  name: string;
  subdomain: string;
  is_active: boolean;
  /** У группы-правила пусто: отель попал в неё условием, а не человеком. */
  added_by: string | null;
  added_at: string | null;
}

export interface GroupsPage {
  items: HotelGroup[];
  kinds: { code: string; title: string }[];
  rule_fields: string[];
}

export const getGroups = () => request<GroupsPage>('/groups');

export const createGroup = (payload: Partial<HotelGroup>) =>
  request<HotelGroup>('/groups', 'POST', payload);

export const patchGroup = (id: string, payload: Partial<HotelGroup>) =>
  request<HotelGroup>(`/groups/${id}`, 'PATCH', payload);

export const deleteGroup = (id: string) => request<{ ok: boolean }>(`/groups/${id}`, 'DELETE');

export const getGroupMembers = (id: string) =>
  request<{ group: HotelGroup; members: GroupMember[] }>(`/groups/${id}/members`);

export const addGroupMembers = (id: string, hotelIds: string[]) =>
  request<{ added: number; size: number }>(`/groups/${id}/members`, 'POST', {
    hotel_ids: hotelIds,
  });

export const removeGroupMember = (id: string, hotelId: string) =>
  request<{ removed: number; size: number }>(`/groups/${id}/members/${hotelId}`, 'DELETE');

/**
 * Выгрузка. Идёт мимо `request`: ответ — CSV, а не JSON, и его нужно отдать
 * браузеру файлом, а не разобрать.
 */
export async function downloadFleetCsv(query: FleetQuery): Promise<void> {
  const token = platformToken.get();
  const res = await fetch(`${BASE}/fleet/export${fleetQuery(query)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new PlatformError(res.status, humanError(res.status));
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
  /** Решение человека: '' — не трогали, модуль следует за тарифом. */
  intent: '' | 'on' | 'off';
  /** Даёт ли нынешний тариф этот модуль. */
  in_tariff: boolean;
  /** Вычисляемая пометка «включено сверх тарифа». Следствие двух полей выше. */
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

export interface ImpersonationQuery {
  /** `active` — кто внутри сейчас, `history` — завершённые, `all` — и те и те. */
  state?: 'active' | 'history' | 'all';
  search?: string;
  limit?: number;
}

export const getImpersonations = (query: ImpersonationQuery = {}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, String(value));
  }
  const qs = params.toString();
  return request<Page<ImpersonationRow>>(`/impersonations${qs ? `?${qs}` : ''}`);
};
export const revokeImpersonation = (id: string) =>
  request<{ grant_id: string; revoked_at: string }>(`/impersonations/${id}/revoke`, 'POST');

export interface HotelAdmin {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
}

/** Кто сегодня админ отеля. До R6 списка не существовало нигде. */
export const getHotelAdmins = (id: string) =>
  request<{ admins: HotelAdmin[] }>(`/hotels/${id}/admins`);

/** Снять право админа. Последнего сервер не отдаёт — вернёт 409 `last_admin`. */
export const removeHotelAdmin = (hotelId: string, userId: string) =>
  request<{ ok: boolean }>(`/hotels/${hotelId}/admins/${userId}`, 'DELETE');

export const getTariffs = () => request<TariffRow[]>('/tariffs');
export const getNodes = (limit = 100) => request<Page<NodeRow>>(`/nodes?limit=${limit}`);
/**
 * Убрать отель из реестра целиком.
 *
 * Не то же, что `purgeHotel`: тот стирает ДАННЫЕ, а этот убирает саму строку и
 * освобождает поддомен. Поддомен передаётся отдельно и сверяется сервером —
 * подтверждение галочкой здесь не годится.
 */
export const deleteHotel = (id: string, confirmSubdomain: string) =>
  request<{ deleted: boolean; subdomain: string; removed: Record<string, number> }>(
    `/hotels/${id}?confirm_subdomain=${encodeURIComponent(confirmSubdomain)}`,
    'DELETE',
  );

/**
 * Сменить адрес администратора отеля НИЧЕГО НЕ ОТПРАВЛЯЯ.
 *
 * Ручка нужна ровно тогда, когда старый ящик потерян: пароль уходит только на
 * адрес администратора, и недоступный адрес запирает отель насмерть.
 */
export const changeAdminEmail = (id: string, body: { current_email: string; new_email: string }) =>
  request<{ email: string; previous_email: string }>(`/hotels/${id}/admins/email`, 'PUT', body);

export const createNode = (hotelId: string, body: { name: string; purpose: string }) =>
  request<{ node: NodeRow; key: string }>(`/hotels/${hotelId}/nodes`, 'POST', body);
export const revokeNode = (id: string) => request<NodeRow>(`/nodes/${id}/revoke`, 'POST');
export const reissueNode = (id: string) =>
  request<{ node: NodeRow; key: string }>(`/nodes/${id}/reissue`, 'POST');

export const getTeam = (limit = 100) => request<Page<TeamMember>>(`/team?limit=${limit}`);
export const inviteMember = (body: { email: string; role: string; full_name?: string }) =>
  request<{ member: TeamMember; password: string }>('/team', 'POST', body);
export const patchMember = (id: string, body: { role?: string; is_active?: boolean }) =>
  request<TeamMember>(`/team/${id}`, 'PATCH', body);

export interface AuditQuery {
  limit?: number;
  cursor?: string | null;
  hotel_id?: string | null;
  action?: string | null;
  since?: string | null;
  until?: string | null;
  /** Поиск по поддомену отеля — фильтрует СЕРВЕР. */
  search?: string | null;
}

export interface AuditPage {
  items: AuditRow[];
  total: number;
  limit: number;
  /** Ключ следующей страницы. `null` — дальше ничего нет. */
  next_cursor: string | null;
}

/**
 * Журнал листается КУРСОРОМ. Смещение здесь не годится: записи добавляются
 * во время просмотра, и вторая страница показала бы часть первой, пропустив
 * столько же — как раз там и оказался бы разыскиваемый инцидент.
 */
export const getAudit = (query: AuditQuery = {}) => {
  const params = new URLSearchParams({ limit: String(query.limit ?? 100) });
  // `search` В СПИСКЕ. Забыть его здесь — это фильтр, который применился на
  // экране и не уехал на сервер: выдача та же, а оператор уверен, что отфильтровал.
  for (const key of ['cursor', 'hotel_id', 'action', 'since', 'until', 'search'] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  return request<AuditPage>(`/audit?${params.toString()}`);
};

export const getAuditActions = () => request<string[]>('/audit/actions');

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

export const getTemplates = (limit = 100) =>
  request<Page<OnboardingTemplate>>(`/templates?limit=${limit}`);
export const patchTemplate = (id: string, body: Partial<OnboardingTemplate>) =>
  request<OnboardingTemplate>(`/templates/${id}`, 'PATCH', body);
export const getDictionary = (limit = 100) =>
  request<Page<DictionaryEntry>>(`/dictionaries?limit=${limit}`);
export const putDictionaryEntry = (body: {
  kind: string;
  code: string;
  title: Record<string, string>;
  is_active?: boolean;
}) => request<DictionaryEntry & { spread: DictionarySpread }>('/dictionaries', 'PUT', body);

/** Что стало с копиями отелей после правки эталона. */
export interface DictionarySpread {
  /** Копии, которые следовали за эталоном и обновились. */
  updated: number;
  /** Копии со своей правкой: их эталон не трогает никогда. */
  kept: number;
  /** Отели, у которых записи не было — она появилась. */
  created: number;
}

export interface DivergenceEntry {
  kind: string;
  code: string;
  state: 'missing' | 'changed' | 'disabled' | 'extra';
  source: { title: Record<string, string>; is_active: boolean } | null;
  local: { title: Record<string, string>; is_active: boolean } | null;
}

export interface DivergenceHotel {
  hotel_id: string;
  name: string;
  subdomain: string;
  counts: Record<string, number>;
  entries: DivergenceEntry[];
}

export interface DivergenceReport {
  hotels: DivergenceHotel[];
  source_size: number;
  diverged_hotels: number;
  total_hotels: number;
}

/* ── Публикация ────────────────────────────────────────────────────────── */

export interface PublicationResultRow {
  hotel_id: string;
  subdomain: string;
  name: string;
  outcome: 'applied' | 'skipped' | 'refused' | 'failed';
  detail: string;
  /** Причина кодом: `same`, `local_edit`, `unknown_origin`, `exception`. */
  reason: string;
}

export interface PublicationJob {
  id: string;
  kind: string;
  description: string;
  scope: 'hotels' | 'group' | 'all';
  group: string;
  actor: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  planned: number;
  error: string;
  created_at: string;
  finished_at: string | null;
  counts: Record<string, number>;
  /** Сколько ещё не отчиталось: запланировано минус записанное. */
  pending: number;
  results?: PublicationResultRow[];
}

export interface PublicationTarget {
  kind: string;
  payload: Record<string, unknown>;
  scope: 'hotels' | 'group' | 'all';
  group_id?: string | null;
  hotel_ids?: string[];
}

export interface PublicationPreview {
  kind: string;
  description: string;
  count: number;
  sample: string[];
}

export const previewPublication = (body: PublicationTarget) =>
  request<PublicationPreview>('/publications/preview', 'POST', body);

export const startPublication = (body: PublicationTarget) =>
  request<PublicationJob>('/publications', 'POST', body);

export const getPublications = () => request<{ items: PublicationJob[] }>('/publications');

export const getPublication = (id: string) => request<PublicationJob>(`/publications/${id}`);

export const getDictionaryDivergence = () =>
  request<DivergenceReport>('/dictionaries/divergence');

/** Вернуть копии названных отелей к эталону. Явное действие, не следствие правки. */
export const resetDictionary = (hotelIds: string[], codes: string[] = []) =>
  request<{ restored: number; created: number }>('/dictionaries/reset', 'POST', {
    hotel_ids: hotelIds,
    codes,
  });

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
  if (!res.ok) throw new PlatformError(res.status, humanError(res.status));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${subdomain}-export.json`;
  link.click();
  URL.revokeObjectURL(url);
}
