/** One function per endpoint of `docs/hotel-admin-api-contract.md` (прогон 8). */
import { API_BASE, HOTEL_SUBDOMAIN, api, tokenStorage } from './client';
import type {
  Department,
  DepartmentPayload,
  HotelLocation,
  LocationMatrix,
  LocationPayload,
  MatrixUpdatePayload,
  Room,
  RoomBulkPayload,
  RoomBulkResult,
  RoomPayload,
  StaffAssignmentsPayload,
  StaffCreatePayload,
  StaffMember,
  StaffPatchPayload,
} from './hotelAdminTypes';

/* ── 1. Rooms ──────────────────────────────────────────────────────────── */

export function fetchRooms(): Promise<Room[]> {
  return api.get<Room[]>('/cms/rooms');
}

export function createRoom(payload: RoomPayload): Promise<Room> {
  return api.post<Room>('/cms/rooms', payload);
}

export function updateRoom(id: string, payload: Partial<RoomPayload>): Promise<Room> {
  return api.patch<Room>(`/cms/rooms/${id}`, payload);
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
  return api.get<HotelLocation[]>('/cms/locations');
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

/* ── 3. Departments ────────────────────────────────────────────────────── */

export function fetchDepartments(): Promise<Department[]> {
  return api.get<Department[]>('/cms/departments');
}

export function createDepartment(payload: DepartmentPayload): Promise<Department> {
  return api.post<Department>('/cms/departments', payload);
}

export function updateDepartment(
  id: string,
  payload: Partial<DepartmentPayload>,
): Promise<Department> {
  return api.patch<Department>(`/cms/departments/${id}`, payload);
}

export function deleteDepartment(id: string): Promise<void> {
  return api.delete<void>(`/cms/departments/${id}`);
}

/* ── 4. Staff ──────────────────────────────────────────────────────────── */

export function fetchStaff(): Promise<StaffMember[]> {
  return api.get<StaffMember[]>('/cms/staff');
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
