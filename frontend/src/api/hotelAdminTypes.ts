/**
 * Types mirroring `docs/hotel-admin-api-contract.md`:
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
  /**
   * Код типа управления номером или `null`.
   *
   * Тот единственный вопрос про GRMS, который админ задаёт, глядя на список:
   * «а этот номер вообще управляется?». `null` — не управляется, и это
   * штатный ответ, а не пробел в данных.
   */
  control_type: string | null;
  /**
   * Номер ВОЗВРАЩЁН из удалённых вместе со своей историей, а не заведён с
   * нуля. Приходит только в ответе на создание — вместе с числами: сколько
   * заказов и сессий вернулось и сколько чужих доступов отозвано.
   */
  restored?: boolean;
  restored_orders?: number;
  restored_sessions?: number;
  revoked_sessions?: number;
  /** Тарифная категория из справочника отеля. `null` — не назначена. */
  category_id: string | null;
  category: { id: string; code: string; title: string } | null;
  /** Состояние уборки. Его ставит персонал; `unknown` — ещё не ставил. */
  housekeeping: RoomHousekeeping;
  /** «Вне продажи» — ОТДЕЛЬНО от `is_active`, который про вход гостя. */
  out_of_service: boolean;
}

export type RoomHousekeeping = 'unknown' | 'clean' | 'dirty' | 'in_progress';

export interface RoomCategory {
  id: string;
  code: string;
  title: Record<string, string>;
  title_i18n: string;
  sort_order: number;
  is_active: boolean;
  rooms_count: number;
}

export interface RoomPayload {
  number: string;
  floor?: string;
  zone?: string;
  is_active?: boolean;
  category_id?: string | null;
  housekeeping?: RoomHousekeeping;
  out_of_service?: boolean;
  /**
   * Смена номера — только с подтверждением: наклейка QR в номере кодирует
   * номер, а имя устройства iRidi собирается из него. Без флага сервер
   * отвечает 409 `rename_needs_confirmation`.
   */
  confirm_rename?: boolean;
  /** Закрепить за связью текущее имя устройства — «оборудование не трогать». */
  keep_device_name?: boolean;
}

/** Что изменится при переименовании. Читается ДО правки, ничего не меняет. */
export interface RoomRenameImpact {
  number: string;
  new_number: string;
  taken: boolean;
  /** Ссылка, которую кодирует наклейка сейчас, — она перестанет работать. */
  qr_url: string;
  qr_url_after: string;
  /** Имя устройства iRidi сейчас и после. Пусто — номер не управляется. */
  device: string;
  device_after: string;
  device_changes: boolean;
  live_sessions: number;
  has_pin: boolean;
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
  /** Стоимость доставки в эту локацию, минорные единицы; 0 = бесплатно. */
  delivery_fee_minor: number;
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
  delivery_fee_minor?: number;
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

/* ── 3. Отдел-исполнитель (для привязки сотрудника) ────────────────────── */

/**
 * Узкий тип: всё, что нужно, чтобы выбрать отдел в привязке сотрудника.
 *
 * Толстый `Department` описывал удалённый `/cms/departments` — с R4 ресурс CMS
 * это СЕРВИС (`@/cms/services/api`), а исполнитель живёт внутри него. Держать
 * рядом устаревшее описание значило бы приглашать писать против него.
 */
export interface StaffDepartment {
  id: string;
  code: string;
  title: Translated;
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
