/**
 * Types mirroring `docs/hotel-admin-api-contract.md` (прогон 8):
 * rooms/QR, locations + category→location matrix, departments, staff.
 *
 * Kept apart from `api/types.ts` because it mirrors a different contract
 * document — the same split the notifications and tracker modules make.
 */

import type { Translated } from './types';

/* ── 1. Rooms ──────────────────────────────────────────────────────────── */

export interface Room {
  id: string;
  number: string;
  floor: string;
  zone: string;
  /** `manual` | `import` … — how the room entered the system. */
  source: string;
  is_active: boolean;
  /** What the QR encodes: the guest deep-link `/r/{number}`. */
  guest_url: string;
}

export interface RoomPayload {
  number: string;
  floor?: string;
  zone?: string;
  is_active?: boolean;
}

export interface RoomBulkPayload {
  from: number;
  to: number;
  floor?: string;
  zone?: string;
  prefix?: string;
  suffix?: string;
}

/** Idempotent: already-existing numbers come back under `skipped`. */
export interface RoomBulkResult {
  created: string[];
  skipped: string[];
}

/* ── 2. Locations ──────────────────────────────────────────────────────── */

export type LocationKind = 'in_room' | 'common_point';

export interface HotelLocation {
  id: string;
  code: string;
  kind: LocationKind;
  title: Translated;
  requires_refinement: boolean;
  refinement_label: Translated;
  schedule_id: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface LocationPayload {
  code?: string;
  kind: LocationKind;
  title: Translated;
  requires_refinement?: boolean;
  refinement_label?: Translated;
  schedule_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

/* ── Category → location matrix ────────────────────────────────────────── */

export type DeliveryMode = 'delivery' | 'pickup';

export const DELIVERY_MODES: DeliveryMode[] = ['delivery', 'pickup'];

export interface MatrixLocation {
  id: string;
  code: string;
  title: Translated;
}

export interface MatrixCell {
  location_id: string;
  enabled: boolean;
  delivery_modes: DeliveryMode[];
}

export interface MatrixRow {
  category_id: string;
  /** The server may send a plain string or a translatable object. */
  category_title: string | Translated;
  cells: MatrixCell[];
}

export interface LocationMatrix {
  locations: MatrixLocation[];
  rows: MatrixRow[];
}

export interface MatrixUpdatePayload {
  category_id: string;
  cells: MatrixCell[];
}

/* ── 3. Departments (execution points) ─────────────────────────────────── */

export type DepartmentKind =
  | 'kitchen'
  | 'bar'
  | 'housekeeping'
  | 'spa'
  | 'reception'
  | 'other';

export const DEPARTMENT_KINDS: DepartmentKind[] = [
  'kitchen',
  'bar',
  'housekeeping',
  'spa',
  'reception',
  'other',
];

export interface Department {
  id: string;
  code: string;
  title: Translated;
  kind: DepartmentKind;
  schedule_id: string | null;
  sla_minutes: number;
  is_active: boolean;
  /** Counters that tie the department back to notifications (прогон 6). */
  staff_count: number;
  channel_count: number;
  has_escalation: boolean;
}

export interface DepartmentPayload {
  code?: string;
  title: Translated;
  kind: DepartmentKind;
  schedule_id?: string | null;
  sla_minutes?: number;
  is_active?: boolean;
}

/* ── 4. Staff ──────────────────────────────────────────────────────────── */

export type StaffLevel = 'member' | 'lead' | 'manager';

export const STAFF_LEVELS: StaffLevel[] = ['member', 'lead', 'manager'];

export interface StaffAssignment {
  id?: string;
  execution_point_id: string;
  execution_point_code?: string;
  level: StaffLevel;
  is_active?: boolean;
}

export interface StaffMember {
  id: string;
  email: string;
  full_name: string;
  language: string;
  is_hotel_admin: boolean;
  is_active: boolean;
  assignments: StaffAssignment[];
}

/** One assignment as sent to the server — code and id are resolved by it. */
export interface StaffAssignmentInput {
  execution_point_id: string;
  level: StaffLevel;
}

export interface StaffCreatePayload {
  email: string;
  full_name: string;
  /** Required on creation, minimum 8 characters. */
  password: string;
  language: string;
  is_hotel_admin?: boolean;
  assignments?: StaffAssignmentInput[];
}

export interface StaffPatchPayload {
  email?: string;
  full_name?: string;
  /** Absent — keep the current password; present — change it. */
  password?: string;
  language?: string;
  is_hotel_admin?: boolean;
  is_active?: boolean;
}

export interface StaffAssignmentsPayload {
  assignments: StaffAssignmentInput[];
}
