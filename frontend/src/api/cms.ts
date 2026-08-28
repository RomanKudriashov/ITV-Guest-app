/** One function per endpoint of docs/cms-api-contract.md. */
import type { OfferingType } from '@/offerings/behaviour';
import { api, request } from './client';
import type {
  ListPage,
  RequestField,
  RequestFieldPayload,
  Badge,
  BadgeItem,
  BadgePayload,
  CropRect,
  Bootstrap,
  Category,
  CategoryPayload,
  CategoryReorderEntry,
  CommerceSettings,
  CommerceSettingsPayload,
  Item,
  ItemBadgeLink,
  ItemPayload,
  LoginResponse,
  MeResponse,
  MediaAsset,
  MediaKind,
  ModifierGroup,
  ModifierGroupPayload,
  ModifierOption,
  ModifierOptionPayload,
  DictEntry,
  DictEntryPayload,
  QuickActions,
  ReorderEntry,
  Schedule,
  SchedulePayload,
  ShowcaseSavePayload,
  ShowcaseSettings,
  SlotConfig,
  SlotConfigPayload,
  StaffUser,
} from './types';

/* ── 1. Staff auth ─────────────────────────────────────────────────────── */

export function login(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/staff/auth/login', {
    method: 'POST',
    body: { email, password },
    skipAuthRedirect: true,
  });
}

/**
 * Обменять одноразовый код входа поддержки на токен.
 *
 * Код приходит хэш-фрагментом и уходит ТЕЛОМ запроса: в адресе его нет ни на
 * одном шаге, поэтому нет и в логах прокси. Повторно тот же код не сработает —
 * обмен гасит его на сервере.
 */
export function exchangeSupportCode(code: string): Promise<{ access: string; expires_at: string }> {
  return request<{ access: string; expires_at: string }>('/staff/auth/support-exchange', {
    method: 'POST',
    body: { code },
    skipAuthRedirect: true,
  });
}

/* ── Сессии персонала ──────────────────────────────────────────────────── */

export interface StaffSessionRow {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string;
  ip: string | null;
  is_current: boolean;
}

export function fetchSessions(): Promise<StaffSessionRow[]> {
  return api.get<StaffSessionRow[]>('/staff/auth/sessions');
}

export function closeSession(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/staff/auth/sessions/${id}`, { method: 'DELETE' });
}

/** Выйти на этом устройстве — рвёт только текущую сессию. */
export function logoutHere(): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>('/staff/auth/logout');
}

/** Выйти везде — все сессии учётки, включая текущую. */
export function logoutEverywhere(): Promise<{ ok: boolean; closed: number }> {
  return api.post<{ ok: boolean; closed: number }>('/staff/auth/logout-all');
}

export function fetchMe(): Promise<MeResponse> {
  return api.get<MeResponse>('/staff/auth/me');
}

/** `/me` may return `{user, hotel}` or a flattened user — normalize both. */
export function normalizeMe(me: MeResponse): StaffUser | null {
  if (me?.user) return me.user;
  if (me?.id && me?.email) {
    return {
      id: me.id,
      email: me.email,
      full_name: me.full_name ?? '',
      is_hotel_admin: me.is_hotel_admin ?? false,
      language: me.language ?? 'ru',
      // Права переносим и здесь: иначе плоский ответ давал пользователя без
      // прав, и посадка после входа считалась бы по пустому месту.
      role: me.role,
      has_cms_access: me.has_cms_access,
      managed_point_ids: me.managed_point_ids,
      member_point_ids: me.member_point_ids,
    };
  }
  return null;
}

/* ── 2. Bootstrap ──────────────────────────────────────────────────────── */

export function fetchBootstrap(): Promise<Bootstrap> {
  return api.get<Bootstrap>('/cms/bootstrap');
}

/* ── 3. Categories ─────────────────────────────────────────────────────── */

export function fetchCategories(serviceId?: string): Promise<Category[]> {
  // `service_id` — наполнение одного заведения: рабочее пространство сервиса
  // показывает меню именно его, а не всю кучу отеля.
  return api.get<Category[]>('/cms/categories', {
    query: serviceId ? { service_id: serviceId } : undefined,
  });
}

export function fetchCategory(id: string): Promise<Category> {
  return api.get<Category>(`/cms/categories/${id}`);
}

export function createCategory(payload: CategoryPayload): Promise<Category> {
  return api.post<Category>('/cms/categories', payload);
}

export function updateCategory(
  id: string,
  payload: Partial<CategoryPayload>,
): Promise<Category> {
  return api.patch<Category>(`/cms/categories/${id}`, payload);
}

export function deleteCategory(id: string, cascade = false): Promise<void> {
  return request<void>(`/cms/categories/${id}`, {
    method: 'DELETE',
    query: { cascade },
  });
}

/** Full new order of the affected nodes, applied in one transaction. */
export function reorderCategories(items: CategoryReorderEntry[]): Promise<Category[]> {
  return api.post<Category[]>('/cms/categories/reorder', { items });
}

export function toggleCategory(id: string, isActive: boolean): Promise<Category> {
  return api.post<Category>(`/cms/categories/${id}/toggle`, { is_active: isActive });
}

/* ── 4. Items ──────────────────────────────────────────────────────────── */

export function fetchItemsPage(params: {
  category_id?: string;
  search?: string;
  /** Filters the list by offering type; omitted means "every type". */
  type?: OfferingType;
  /** Scopes the list to one venue — the service workspace (R4). */
  service_id?: string;
  limit?: number;
  offset?: number;
}): Promise<ListPage<Item>> {
  return api.get<ListPage<Item>>('/cms/items', { query: params });
}

/**
 * Только строки — для экранов, которым счётчик не нужен.
 *
 * Разворот живёт ЗДЕСЬ, а не в каждом экране: иначе `.items` расползётся по
 * два десятка мест, и половина из них однажды забудет про `total`.
 */
export function fetchItems(params: Parameters<typeof fetchItemsPage>[0]): Promise<Item[]> {
  return fetchItemsPage(params).then((page) => page.items);
}

export function fetchItem(id: string): Promise<Item> {
  return api.get<Item>(`/cms/items/${id}`);
}

export function createItem(payload: ItemPayload): Promise<Item> {
  return api.post<Item>('/cms/items', payload);
}

export function updateItem(id: string, payload: Partial<ItemPayload>): Promise<Item> {
  return api.patch<Item>(`/cms/items/${id}`, payload);
}

export function deleteItem(id: string): Promise<void> {
  return api.delete<void>(`/cms/items/${id}`);
}

export function reorderItems(
  categoryId: string,
  items: ReorderEntry[],
): Promise<Item[]> {
  return api.post<Item[]>('/cms/items/reorder', { category_id: categoryId, items });
}

export function setItemStock(id: string, inStock: boolean): Promise<Item> {
  return api.post<Item>(`/cms/items/${id}/stock`, { in_stock: inStock });
}

export function toggleItem(id: string, isActive: boolean): Promise<Item> {
  return api.post<Item>(`/cms/items/${id}/toggle`, { is_active: isActive });
}

/** Replaces the whole image set of the item, in the given order. */
export function putItemImages(id: string, imageIds: string[]): Promise<MediaAsset[]> {
  return api.put<MediaAsset[]>(`/cms/items/${id}/images`, { image_ids: imageIds });
}

/* ── 5a. Request fields (contract §5a) ─────────────────────────────────── */

export function createRequestField(
  itemId: string,
  payload: RequestFieldPayload,
): Promise<RequestField> {
  return api.post<RequestField>(`/cms/items/${itemId}/request-fields`, payload);
}

export function updateRequestField(
  id: string,
  payload: Partial<RequestFieldPayload>,
): Promise<RequestField> {
  return api.patch<RequestField>(`/cms/request-fields/${id}`, payload);
}

export function deleteRequestField(id: string): Promise<void> {
  return api.delete<void>(`/cms/request-fields/${id}`);
}

export function reorderRequestFields(
  itemId: string,
  items: ReorderEntry[],
): Promise<RequestField[]> {
  return api.post<RequestField[]>(`/cms/items/${itemId}/request-fields/reorder`, { items });
}

/* ── 5b. Slot configuration (contract §slot CMS) ───────────────────────── */

export function fetchSlotConfig(itemId: string): Promise<SlotConfig> {
  return api.get<SlotConfig>(`/cms/items/${itemId}/slot-config`);
}

export function putSlotConfig(
  itemId: string,
  payload: SlotConfigPayload,
): Promise<SlotConfig> {
  return api.put<SlotConfig>(`/cms/items/${itemId}/slot-config`, payload);
}

/* ── 5. Modifier groups & options ──────────────────────────────────────── */

export function createModifierGroup(
  itemId: string,
  payload: ModifierGroupPayload,
): Promise<ModifierGroup> {
  return api.post<ModifierGroup>(`/cms/items/${itemId}/modifier-groups`, payload);
}

export function updateModifierGroup(
  id: string,
  payload: Partial<ModifierGroupPayload>,
): Promise<ModifierGroup> {
  return api.patch<ModifierGroup>(`/cms/modifier-groups/${id}`, payload);
}

export function deleteModifierGroup(id: string): Promise<void> {
  return api.delete<void>(`/cms/modifier-groups/${id}`);
}

export function reorderModifierGroups(
  itemId: string,
  items: ReorderEntry[],
): Promise<ModifierGroup[]> {
  return api.post<ModifierGroup[]>(`/cms/items/${itemId}/modifier-groups/reorder`, {
    items,
  });
}

export function createModifierOption(
  groupId: string,
  payload: ModifierOptionPayload,
): Promise<ModifierOption> {
  return api.post<ModifierOption>(`/cms/modifier-groups/${groupId}/options`, payload);
}

export function updateModifierOption(
  id: string,
  payload: Partial<ModifierOptionPayload>,
): Promise<ModifierOption> {
  return api.patch<ModifierOption>(`/cms/modifier-options/${id}`, payload);
}

export function deleteModifierOption(id: string): Promise<void> {
  return api.delete<void>(`/cms/modifier-options/${id}`);
}

export function reorderModifierOptions(
  groupId: string,
  items: ReorderEntry[],
): Promise<ModifierOption[]> {
  return api.post<ModifierOption[]>(`/cms/modifier-groups/${groupId}/options/reorder`, {
    items,
  });
}

/* ── 6. Media ──────────────────────────────────────────────────────────── */

export function uploadMedia(file: File, kind: MediaKind = 'item'): Promise<MediaAsset> {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  return request<MediaAsset>('/cms/media', { method: 'POST', formData: form });
}

export function fetchMedia(id: string): Promise<MediaAsset> {
  return api.get<MediaAsset>(`/cms/media/${id}`);
}

/* ── 7. Schedules ──────────────────────────────────────────────────────── */

export function fetchSchedules(): Promise<Schedule[]> {
  return api.get<ListPage<Schedule>>('/cms/schedules').then((page) => page.items);
}

export function createSchedule(payload: SchedulePayload): Promise<Schedule> {
  return api.post<Schedule>('/cms/schedules', payload);
}

export function updateSchedule(
  id: string,
  payload: Partial<SchedulePayload>,
): Promise<Schedule> {
  return api.patch<Schedule>(`/cms/schedules/${id}`, payload);
}

export function deleteSchedule(id: string): Promise<void> {
  return api.delete<void>(`/cms/schedules/${id}`);
}

/* ── 8. Commerce settings ──────────────────────────────────────────────── */

export function fetchCommerceSettings(): Promise<CommerceSettings> {
  return api.get<CommerceSettings>('/cms/commerce-settings');
}

/** PATCH sends only the changed keys. */
export function updateCommerceSettings(
  payload: CommerceSettingsPayload,
): Promise<CommerceSettings> {
  return api.patch<CommerceSettings>('/cms/commerce-settings', payload);
}

/* ── 8b. Где заведения отступают от коммерции отеля ────────────────────── */

export type OverrideState = 'changed' | 'pinned';

export interface CommerceOverrideField {
  field: string;
  label: string;
  state: OverrideState;
  hotel: number | number[] | null;
  own: number | number[] | null;
}

export interface CommerceOverrideRow {
  service_id: string;
  code: string;
  name: Record<string, string>;
  counts: Record<string, number>;
  fields: CommerceOverrideField[];
}

export interface CommerceOverrides {
  hotel: Record<string, number | number[] | null>;
  services: CommerceOverrideRow[];
  with_own: number;
  total_services: number;
}

export function fetchCommerceOverrides(): Promise<CommerceOverrides> {
  return api.get<CommerceOverrides>('/cms/commerce-settings/overrides');
}

export function resetCommerceOverrides(
  serviceIds: string[],
  fields?: string[],
): Promise<{ changed: number }> {
  return api.post<{ changed: number }>('/cms/commerce-settings/overrides/reset', {
    service_ids: serviceIds,
    fields,
  });
}

/* ── 8c. Где порог просрочки переопределён ─────────────────────────────── */

export interface SlaOverrideRow {
  point_id: string;
  code: string;
  title: Record<string, string>;
  kind: string;
  state: 'inherited' | OverrideState;
  default_minutes: number;
  own_minutes: number | null;
  effective_minutes: number;
}

export interface SlaOverrides {
  points: SlaOverrideRow[];
  overridden: number;
  total_points: number;
}

export function fetchSlaOverrides(): Promise<SlaOverrides> {
  return api.get<SlaOverrides>('/cms/services/sla-overrides');
}

export function resetSlaOverrides(pointIds: string[]): Promise<{ changed: number }> {
  return api.post<{ changed: number }>('/cms/services/sla-overrides/reset', {
    point_ids: pointIds,
  });
}

/* ── 8d. Оформление: своё или пресет платформы ─────────────────────────── */

export interface BrandLook {
  state: 'follows' | 'changed' | 'extra';
  label: string;
  preset: string;
  theme: string | null;
}

export function fetchBrandLook(): Promise<BrandLook> {
  return api.get<BrandLook>('/cms/brand/look');
}

/* ── 9b. Allergen / dietary-marker dictionaries ────────────────────────── */

export function fetchAllergens(): Promise<DictEntry[]> {
  return api.get<ListPage<DictEntry>>('/cms/allergens').then((page) => page.items);
}
export function createAllergen(payload: DictEntryPayload): Promise<DictEntry> {
  return api.post<DictEntry>('/cms/allergens', payload);
}
export function updateAllergen(id: string, payload: Partial<DictEntryPayload>): Promise<DictEntry> {
  return api.patch<DictEntry>(`/cms/allergens/${id}`, payload);
}
export function deleteAllergen(id: string): Promise<void> {
  return api.delete<void>(`/cms/allergens/${id}`);
}
export function fetchMarkers(): Promise<DictEntry[]> {
  return api.get<ListPage<DictEntry>>('/cms/markers').then((page) => page.items);
}
export function createMarker(payload: DictEntryPayload): Promise<DictEntry> {
  return api.post<DictEntry>('/cms/markers', payload);
}
export function updateMarker(id: string, payload: Partial<DictEntryPayload>): Promise<DictEntry> {
  return api.patch<DictEntry>(`/cms/markers/${id}`, payload);
}
export function deleteMarker(id: string): Promise<void> {
  return api.delete<void>(`/cms/markers/${id}`);
}

/* ── 9. Marketing badges ───────────────────────────────────────────────── */

export function fetchBadges(): Promise<Badge[]> {
  return api.get<ListPage<Badge>>('/cms/badges').then((page) => page.items);
}

/** Позиции, которые носят эту метку. Обратная сторона связи. */
export function fetchBadgeItems(badgeId: string): Promise<BadgeItem[]> {
  return api
    .get<ListPage<BadgeItem>>(`/cms/badges/${badgeId}/items`)
    .then((page) => page.items);
}

/**
 * Повесить или снять ОДНУ метку с ОДНОЙ позиции.
 *
 * Не `assignItemBadges`: тот заменяет весь набор метки позиции и живёт в её
 * редакторе. Здесь разрез со стороны метки, и чужие метки позиции трогать
 * нельзя.
 */
export function setBadgeOnItem(
  badgeId: string,
  itemId: string,
  attached: boolean,
): Promise<{ item_id: string; attached: boolean }> {
  return api.put(`/cms/badges/${badgeId}/items/${itemId}`, { attached });
}

/**
 * Записать рамку кадра. Сервер режет варианты ИЗ ОРИГИНАЛА и возвращает ассет
 * в статусе `pending`: нарезка идёт в воркере.
 */
export function setMediaCrop(
  id: string,
  crop: CropRect | null,
  ratio?: number,
): Promise<MediaAsset> {
  return api.put<MediaAsset>(`/cms/media/${id}/crop`, { crop, ratio: ratio ?? null });
}

export function createBadge(payload: BadgePayload): Promise<Badge> {
  return api.post<Badge>('/cms/badges', payload);
}

export function updateBadge(id: string, payload: Partial<BadgePayload>): Promise<Badge> {
  return api.patch<Badge>(`/cms/badges/${id}`, payload);
}

export function deleteBadge(id: string): Promise<void> {
  return api.delete<void>(`/cms/badges/${id}`);
}

/** Replaces the whole badge set of an item, in the given order. */
export function assignItemBadges(
  itemId: string,
  badgeIds: string[],
): Promise<{ badges: ItemBadgeLink[] }> {
  return api.put<{ badges: ItemBadgeLink[] }>(`/cms/items/${itemId}/badges`, {
    badge_ids: badgeIds,
  });
}

/* ── 10. Quick actions ─────────────────────────────────────────────────── */

export function fetchQuickActions(): Promise<QuickActions> {
  return api.get<QuickActions>('/cms/quick-actions');
}

/** Replaces the ordered set of selected quick actions. */
export function putQuickActions(selected: string[]): Promise<QuickActions> {
  return api.put<QuickActions>('/cms/quick-actions', { selected });
}

/* ── 10a. Home blocks: weather, coordinates, room status ─────────────────── */

export interface HomeSettings {
  weather: boolean;
  room_status: boolean;
  latitude: number | null;
  longitude: number | null;
  /**
   * Название отеля переводами.
   *
   * Имя собственное на всех языках одно и латиницей — так его пишут на
   * вывеске и в картах; переводится слово вокруг него.
   */
  name: Record<string, string>;
  /** Город — подпись к погоде и часам, переводами. */
  city: Record<string, string>;
  /** Часовой пояс отеля — ИМЯ зоны IANA, от него считаются и часы, и расписания. */
  timezone: string;
  /** Список зон приходит с сервера: он меняется решениями правительств. */
  timezone_options: string[];
  /** Погоду нельзя включить без координат — сервер говорит об этом прямо. */
  weather_available: boolean;
  /** Строка номера имеет смысл только с модулем управления. */
  room_status_available: boolean;
  /** Кого атрибутировать у гостя: условие лицензии провайдера. */
  weather_provider: { name: string; url: string };
}

export function fetchHomeSettings(): Promise<HomeSettings> {
  return api.get<HomeSettings>('/cms/home-settings');
}

export function putHomeSettings(
  payload: Pick<
    HomeSettings,
    'weather' | 'room_status' | 'latitude' | 'longitude' | 'city' | 'timezone' | 'name'
  >,
): Promise<HomeSettings> {
  return api.put<HomeSettings>('/cms/home-settings', payload);
}

/* ── 10b. Guest search ───────────────────────────────────────────────────── */

export interface SearchSettings {
  services: boolean;
  items: boolean;
  info: boolean;
  excluded_services: string[];
  /** Подсказка — перевод на четыре языка, а не строка. */
  suggestions: Record<string, string>[];
  available_services: { code: string; title: Record<string, string> }[];
}

export function fetchSearchSettings(): Promise<SearchSettings> {
  return api.get<SearchSettings>('/cms/search-settings');
}

export function putSearchSettings(
  payload: Omit<SearchSettings, 'available_services'>,
): Promise<SearchSettings> {
  return api.put<SearchSettings>('/cms/search-settings', payload);
}

/* ── 11. Home showcase tiles ────────────────────────────────────────────── */

export function fetchShowcase(): Promise<ShowcaseSettings> {
  return api.get<ShowcaseSettings>('/cms/showcase');
}

/** Persists the grouping threshold and/or per-tile size/order/visibility. */
export function putShowcase(payload: ShowcaseSavePayload): Promise<ShowcaseSettings> {
  return api.put<ShowcaseSettings>('/cms/showcase', payload);
}
