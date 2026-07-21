/**
 * Guest storefront API types — mirror of docs/guest-api-contract.md.
 *
 * Two conventions differ from the CMS API on purpose:
 *  - texts arrive already localized (plain strings, not `{lang: value}` maps);
 *  - money is an integer in minor units, the exponent is `currency_minor_units`.
 */

import type { PartialBrandTokens } from '@/theme/tokens';

export type GuestTrust = 'anonymous' | 'room_scanned' | 'pms_verified' | 'staff_verified';

export interface GuestLanguage {
  code: string;
  title: string;
}

export interface GuestHotel {
  id: string;
  name: string;
  subdomain: string;
  currency: string;
  /** Exponent of the minor unit (RUB → 2). Optional while the backend catches up. */
  currency_minor_units?: number;
  timezone: string;
  default_language: string;
  languages?: GuestLanguage[];
  /** Hotel brand tokens, applied through `setBrandTokens`. */
  theme?: PartialBrandTokens;
}

export interface GuestSession {
  session_id: string;
  trust: GuestTrust;
  expires_at: string;
  language?: string;
  room: string | null;
  hotel: GuestHotel;
}

export interface GuestSessionCreated extends GuestSession {
  token: string;
}

export interface CreateSessionPayload {
  room_number?: string | null;
  language?: string;
}

/** Payload of the 404 returned for an unknown room number. */
export interface RoomNotFoundPayload {
  detail: string;
  code: 'room_not_found';
  hint?: string;
  hotel?: GuestHotel;
}

export type UnavailableReason = 'schedule' | 'out_of_stock' | 'inactive' | string;

export interface ModifierOption {
  id: string;
  code: string;
  title: string;
  price_delta: number;
  is_default?: boolean;
}

export interface ModifierGroup {
  id: string;
  code: string;
  title: string;
  selection: 'single' | 'multi';
  is_required: boolean;
  min_choices: number;
  max_choices: number;
  options: ModifierOption[];
}

export interface MenuItem {
  id: string;
  code: string;
  category_id: string;
  title: string;
  description: string;
  price: number;
  images: string[];
  flags: string[];
  allergens: string[];
  has_modifiers?: boolean;
  has_required_modifiers?: boolean;
  is_available: boolean;
  unavailable_reason: UnavailableReason | null;
  available_from?: string | null;
  /** Some deployments inline the groups in the list response; the sheet still refetches. */
  modifier_groups?: ModifierGroup[];
}

export interface MenuCategory {
  id: string;
  code: string;
  title: string;
  description: string;
  image_url: string | null;
  sort_order: number;
  is_available: boolean;
  unavailable_reason: UnavailableReason | null;
  available_from?: string | null;
  available_until?: string | null;
  items: MenuItem[];
}

export interface GuestMenu {
  language: string;
  server_time?: string;
  categories: MenuCategory[];
}

export interface ItemDetail extends MenuItem {
  category_title?: string;
  modifier_groups: ModifierGroup[];
}

export interface GuestLocation {
  id: string;
  code: string;
  kind: string;
  title: string;
  requires_refinement: boolean;
  refinement_label: string | null;
  is_default: boolean;
}

export interface GuestLocations {
  room: string | null;
  locations: GuestLocation[];
  delivery_modes: string[];
}

export type OrderTiming = 'asap' | 'scheduled';

export interface OrderLinePayload {
  item_id: string;
  quantity: number;
  modifier_option_ids: string[];
  comment: string;
}

export interface CreateOrderPayload {
  lines: OrderLinePayload[];
  location_id: string;
  location_refinement: string;
  delivery_mode: string;
  timing: OrderTiming;
  requested_time: string | null;
  comment: string;
}

export interface OrderStatus {
  code: string;
  title: string;
  sort_order: number;
  is_terminal: boolean;
  is_cancelled: boolean;
  color_token?: string;
  allows_guest_cancel: boolean;
}

export interface OrderStatusFlowStep {
  code: string;
  title: string;
  sort_order: number;
  is_cancelled: boolean;
}

export interface OrderHistoryEntry {
  code: string;
  title: string;
  at: string;
}

export interface OrderModifier {
  code: string;
  title: string;
  price_delta: number;
}

export interface OrderItem {
  id: string;
  item_id: string;
  title: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  comment: string;
  image_url: string | null;
  modifiers: OrderModifier[];
}

export interface GuestOrder {
  id: string;
  number: number;
  created_at: string;
  status: OrderStatus;
  status_flow: OrderStatusFlowStep[];
  history: OrderHistoryEntry[];
  room: string | null;
  location: { code: string; title: string; refinement: string } | null;
  delivery_mode: string;
  requested_time: string | null;
  eta_minutes: number | null;
  comment: string;
  total: number;
  currency: string;
  items: OrderItem[];
}

export interface GuestOrderList {
  active: GuestOrder[];
  past: GuestOrder[];
}

/** WebSocket envelope — reconciliation snapshots only, never deltas. */
export interface OrderSnapshotMessage {
  type: 'order.snapshot';
  event?: string;
  order: GuestOrder;
}

export interface PingMessage {
  type: 'ping';
}

export type GuestSocketMessage = OrderSnapshotMessage | PingMessage | { type: string };
