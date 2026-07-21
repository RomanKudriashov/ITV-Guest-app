/** One function per endpoint of docs/cms-api-contract.md. */
import type { OfferingType } from '@/offerings/behaviour';
import { api, request } from './client';
import type {
  RequestField,
  RequestFieldPayload,
  Bootstrap,
  Category,
  CategoryPayload,
  CategoryReorderEntry,
  Item,
  ItemPayload,
  LoginResponse,
  MeResponse,
  MediaAsset,
  MediaKind,
  ModifierGroup,
  ModifierGroupPayload,
  ModifierOption,
  ModifierOptionPayload,
  ReorderEntry,
  Schedule,
  SchedulePayload,
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
    };
  }
  return null;
}

/* ── 2. Bootstrap ──────────────────────────────────────────────────────── */

export function fetchBootstrap(): Promise<Bootstrap> {
  return api.get<Bootstrap>('/cms/bootstrap');
}

/* ── 3. Categories ─────────────────────────────────────────────────────── */

export function fetchCategories(): Promise<Category[]> {
  return api.get<Category[]>('/cms/categories');
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

export function fetchItems(params: {
  category_id?: string;
  search?: string;
  /** Filters the list by offering type; omitted means "every type". */
  type?: OfferingType;
}): Promise<Item[]> {
  return api.get<Item[]>('/cms/items', { query: params });
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
  return api.get<Schedule[]>('/cms/schedules');
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
