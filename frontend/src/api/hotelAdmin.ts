/** One function per endpoint of `docs/hotel-admin-api-contract.md`. */
import { API_BASE, HOTEL_SUBDOMAIN, api, tokenStorage } from './client';
import type { ListPage } from './types';
import type {
  Building,
  HotelLocation,
  LocationMatrix,
  LocationPayload,
  MatrixUpdatePayload,
  Room,
  RoomBulkPatch,
  RoomBulkPayload,
  RoomBulkPreview,
  RoomBulkResult,
  RoomBulkUpdateResult,
  RoomCategory,
  RoomFilters,
  RoomPayload,
  RoomRenameImpact,
  RoomSelection,
  RoomsGrid,
  StaffAssignmentsPayload,
  StaffCreatePayload,
  StaffMember,
  StaffPatchPayload,
} from './hotelAdminTypes';

/* ── 1. Rooms ──────────────────────────────────────────────────────────── */

/** Сколько номеров на странице. Столько же уходит в запрос. */
export const ROOMS_PAGE_SIZE = 50;

export function fetchRooms(
  search = '',
  page: { limit: number; offset: number } = { limit: ROOMS_PAGE_SIZE, offset: 0 },
  filters: RoomFilters = {},
): Promise<ListPage<Room>> {
  /*
    Поиск уходит НА СЕРВЕР: отсев уже скачанного списка врал бы счётчиком
    ровно так же, как это делал журнал платформы.

    ОБОЛОЧКА ЦЕЛИКОМ, А НЕ ТОЛЬКО `items`. Раньше отсюда возвращался массив, а
    `total` выбрасывался: сервер отдавал сотню (предел по умолчанию), экран
    показывал сотню и молчал о том, что это часть. На фонде в триста номеров
    двести из них не существовали для администратора.
  */
  return api.get<ListPage<Room>>('/cms/rooms', {
    query: {
      ...(search ? { search } : {}),
      ...roomFilterQuery(filters),
      limit: String(page.limit),
      offset: String(page.offset),
    },
  });
}

/**
 * Сетка фонда: весь фонд разом, без листания и БЕЗ фильтров.
 *
 * Фильтры сюда не уходят намеренно: на сетке отфильтрованное гасится, а не
 * исчезает — убрав кубики, мы порвём ряды, и соседние номера перестанут стоять
 * рядом. Гасит клиент.
 */
export function fetchRoomsGrid(): Promise<RoomsGrid> {
  return api.get<RoomsGrid>('/cms/rooms/grid');
}

/** Фильтры → строка запроса. Пустые не уходят: `?floor=` это не фильтр. */
function roomFilterQuery(filters: RoomFilters): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.floor) query.floor = filters.floor;
  if (filters.zone) query.zone = filters.zone;
  if (filters.category) query.category = filters.category;
  if (filters.housekeeping) query.housekeeping = filters.housekeeping;
  if (filters.out_of_service !== undefined) {
    query.out_of_service = String(filters.out_of_service);
  }
  if (filters.has_orders) query.has_orders = 'true';
  if (filters.has_control) query.has_control = 'true';
  return query;
}

/**
 * Предпросмотр заведения пачкой. Отдельная ручка, которая НИЧЕГО не создаёт —
 * поэтому её можно звать на каждый ввод, пока человек правит строку.
 */
export function previewBulkRooms(payload: RoomBulkPayload): Promise<RoomBulkPreview> {
  return api.post<RoomBulkPreview>('/cms/rooms/bulk/preview', payload);
}

/**
 * Массовая правка. Выборка — либо отмеченные строки, либо «все по фильтрам»;
 * во втором случае множество строит сервер по тем же фильтрам, что и список.
 */
export function bulkUpdateRooms(
  selection: RoomSelection,
  patch: RoomBulkPatch,
): Promise<RoomBulkUpdateResult> {
  return api.post<RoomBulkUpdateResult>('/cms/rooms/bulk-update', { selection, patch });
}

/* ── 1a. Корпуса ───────────────────────────────────────────────────────── */
//
// Устроены как категории номеров и намеренно: это два справочника одного
// экрана, и разный вид означал бы разное поведение там, где человек ждёт
// одинакового.

export function fetchBuildings(): Promise<Building[]> {
  return api.get<ListPage<Building>>('/cms/buildings').then((page) => page.items);
}

export function createBuilding(payload: {
  title: Record<string, string>;
  code?: string;
  sort_order?: number;
}): Promise<Building> {
  return api.post<Building>('/cms/buildings', payload);
}

export function updateBuilding(
  id: string,
  payload: { title?: Record<string, string>; sort_order?: number; is_active?: boolean },
): Promise<Building> {
  return api.patch<Building>(`/cms/buildings/${id}`, payload);
}

export function deleteBuilding(id: string): Promise<void> {
  return api.delete(`/cms/buildings/${id}`).then(() => undefined);
}

/* ── 1b. Room categories ───────────────────────────────────────────────── */

export function fetchRoomCategories(): Promise<RoomCategory[]> {
  return api.get<ListPage<RoomCategory>>('/cms/room-categories').then((page) => page.items);
}

export function createRoomCategory(payload: {
  title: Record<string, string>;
  code?: string;
  sort_order?: number;
}): Promise<RoomCategory> {
  return api.post<RoomCategory>('/cms/room-categories', payload);
}

export function updateRoomCategory(
  id: string,
  payload: { title?: Record<string, string>; sort_order?: number; is_active?: boolean },
): Promise<RoomCategory> {
  return api.patch<RoomCategory>(`/cms/room-categories/${id}`, payload);
}

export function deleteRoomCategory(id: string): Promise<void> {
  return api.delete(`/cms/room-categories/${id}`).then(() => undefined);
}

/**
 * Что изменится при переименовании номера: какая ссылка QR умрёт и на какое
 * имя уедет устройство iRidi. Только чтение — зовётся из диалога до правки.
 */
export function fetchRenameImpact(id: string, number: string): Promise<RoomRenameImpact> {
  return api.get<RoomRenameImpact>(`/cms/rooms/${id}/rename-check`, {
    query: { number },
  });
}

export function createRoom(payload: RoomPayload): Promise<Room> {
  return api.post<Room>('/cms/rooms', payload);
}

export function updateRoom(id: string, payload: Partial<RoomPayload>): Promise<Room> {
  return api.patch<Room>(`/cms/rooms/${id}`, payload);
}

/** Итог отметки выезда: сколько сессий погашено и сколько из них управляли номером. */
export interface CheckoutResult {
  room: string;
  revoked: number;
  verified_revoked: number;
}

/**
 * Отметить выезд гостя: отозвать все живые сессии номера.
 *
 * Не «сменить PIN»: смена кода была побочным способом добиться того же и
 * работала только у отелей с управлением номером. Выезд нужен всем.
 */
export function checkOutRoom(id: string): Promise<CheckoutResult> {
  return api.post<CheckoutResult>(`/cms/rooms/${id}/checkout`);
}

export function deleteRoom(id: string): Promise<void> {
  return api.delete<void>(`/cms/rooms/${id}`);
}

/** Generates a range; already-existing numbers are skipped silently. */
export function bulkCreateRooms(payload: RoomBulkPayload): Promise<RoomBulkResult> {
  return api.post<RoomBulkResult>('/cms/rooms/bulk', payload);
}

/* ── QR assets ─────────────────────────────────────────────────────────── */

/**
 * QR endpoints answer with an image, not JSON, and — like the rest of the CMS —
 * expect the auth and tenant headers. An `<img src>` cannot carry them, so the
 * SVG is fetched as text and injected inline; the PNG is fetched as a blob and
 * offered as a download.
 */
async function fetchQrAsset(id: string, ext: 'svg' | 'png'): Promise<Blob> {
  const headers: Record<string, string> = {
    Accept: ext === 'svg' ? 'image/svg+xml' : 'image/png',
    'X-Hotel-Subdomain': HOTEL_SUBDOMAIN,
  };
  const token = tokenStorage.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}/cms/rooms/${id}/qr.${ext}`, { headers });
  if (!response.ok) throw new Error(`QR ${ext} request failed: ${response.status}`);
  return response.blob();
}

export async function fetchRoomQrSvg(id: string): Promise<string> {
  return (await fetchQrAsset(id, 'svg')).text();
}

export async function downloadRoomQrPng(id: string, roomNumber: string): Promise<void> {
  const blob = await fetchQrAsset(id, 'png');
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `qr-${roomNumber}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The print sheet is a self-contained HTML page, but the whole `/api/cms`
 * surface sits behind staff JWT — and a `window.open` on the raw URL cannot
 * carry `Authorization`/`X-Hotel-Subdomain`, so it would 401. Instead it is
 * fetched with the authorized client and the HTML is handed to the caller to
 * open from a blob URL.
 */
export async function fetchRoomQrSheetHtml(): Promise<string> {
  const headers: Record<string, string> = {
    Accept: 'text/html',
    'X-Hotel-Subdomain': HOTEL_SUBDOMAIN,
  };
  const token = tokenStorage.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}/cms/rooms/qr-sheet`, { headers });
  if (!response.ok) throw new Error(`QR sheet request failed: ${response.status}`);
  return response.text();
}

/* ── 2. Locations ──────────────────────────────────────────────────────── */

export function fetchLocations(): Promise<HotelLocation[]> {
  return api.get<ListPage<HotelLocation>>('/cms/locations').then((page) => page.items);
}

export function createLocation(payload: LocationPayload): Promise<HotelLocation> {
  return api.post<HotelLocation>('/cms/locations', payload);
}

export function updateLocation(
  id: string,
  payload: Partial<LocationPayload>,
): Promise<HotelLocation> {
  return api.patch<HotelLocation>(`/cms/locations/${id}`, payload);
}

export function deleteLocation(id: string): Promise<void> {
  return api.delete<void>(`/cms/locations/${id}`);
}

export function fetchLocationMatrix(): Promise<LocationMatrix> {
  return api.get<LocationMatrix>('/cms/locations/matrix');
}

/** Replaces one category row of the matrix in full. */
export function updateLocationMatrix(payload: MatrixUpdatePayload): Promise<LocationMatrix> {
  return api.put<LocationMatrix>('/cms/locations/matrix', payload);
}

/* ── 4. Staff ──────────────────────────────────────────────────────────── */

export function fetchStaff(search = ''): Promise<StaffMember[]> {
  return api
    .get<ListPage<StaffMember>>('/cms/staff', { query: search ? { search } : undefined })
    .then((page) => page.items);
}

export function createStaff(payload: StaffCreatePayload): Promise<StaffMember> {
  return api.post<StaffMember>('/cms/staff', payload);
}

/** PATCH without `password` keeps the current one — the caller omits it. */
export function updateStaff(id: string, payload: StaffPatchPayload): Promise<StaffMember> {
  return api.patch<StaffMember>(`/cms/staff/${id}`, payload);
}

export function deleteStaff(id: string): Promise<void> {
  return api.delete<void>(`/cms/staff/${id}`);
}

/** Replaces the whole set of assignments. */
export function updateStaffAssignments(
  id: string,
  payload: StaffAssignmentsPayload,
): Promise<StaffMember> {
  return api.put<StaffMember>(`/cms/staff/${id}/assignments`, payload);
}
