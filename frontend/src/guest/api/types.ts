/**
 * Guest storefront API types — mirror of docs/guest-api-contract.md.
 *
 * Two conventions differ from the CMS API on purpose:
 *  - texts arrive already localized (plain strings, not `{lang: value}` maps);
 *  - money is an integer in minor units, the exponent is `currency_minor_units`.
 */

import type { LocationMode, OfferingType } from '@/offerings/behaviour';
import type { RequestFieldType } from '@/offerings/requestFields';
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

/** One option of a `select` field, already localized. */
export interface RequestFieldOption {
  value: string;
  label: string;
}

/**
 * A field of a request form, as the storefront receives it: labels are plain
 * localized strings (the CMS keeps the `{lang: ...}` maps, the guest does not).
 */
export interface RequestField {
  code: string;
  label: string;
  field_type: RequestFieldType;
  is_required: boolean;
  help_text?: string;
  options?: RequestFieldOption[];
  min_value?: number | null;
  max_value?: number | null;
  sort_order?: number;
}

/** A marketing badge on a menu item; `label` arrives already localized. */
export interface MenuBadge {
  label: string;
  /** Palette role (`accent`/`gold`/`success`/`info`) → fill color via `badgeRoleColor`. */
  color_role: string;
  sort_order: number;
}

export interface MenuItem {
  id: string;
  code: string;
  category_id: string;
  title: string;
  description: string;
  /** `null` — "price not set" (a request-service may be unpriced), not "free". */
  price: number | null;
  images: string[];
  flags: string[];
  allergens: string[];
  /** Marketing badges, rendered sorted by `sort_order`. */
  badges?: MenuBadge[];
  /** Preparation time in minutes, or `null` when the item does not carry one. */
  prep_minutes?: number | null;
  /** Offering type; the storefront asks the behaviour registry, never the string. */
  type?: OfferingType;
  location_mode?: LocationMode;
  has_modifiers?: boolean;
  has_required_modifiers?: boolean;
  /** True when the item is filled in with a form instead of the cart. */
  has_fields?: boolean;
  /** False for an `info` page — the catalog then shows a read link, not an order. */
  is_orderable?: boolean;
  /** Body of an `info` page — markup-ish text, already localized to a string. */
  content?: string;
  is_available: boolean;
  unavailable_reason: UnavailableReason | null;
  available_from?: string | null;
  /** Some deployments inline the groups in the list response; the sheet still refetches. */
  modifier_groups?: ModifierGroup[];
  /**
   * Nutrition facts shown on the item card. Optional and every field within is
   * optional too: a card renders only the blocks the item actually carries, it
   * never branches on the offering type.
   */
  nutrition?: {
    calories?: number;
    protein?: number;
    fat?: number;
    carbs?: number;
    composition?: string;
  } | null;
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

/** `GET /api/guest/catalog?type=…` — one envelope for every offering type. */
export interface GuestCatalog {
  language: string;
  server_time?: string;
  categories: MenuCategory[];
}

export interface ItemDetail extends MenuItem {
  category_title?: string;
  modifier_groups: ModifierGroup[];
  /** Empty for a product — the envelope is shared, the unused block is just empty. */
  request_fields?: RequestField[];
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

/** One bookable interval of a `slot` offering (contract §slot availability). */
export interface GuestSlot {
  starts_at: string;
  ends_at?: string;
  /** Remaining capacity on this interval; `0` when fully booked. */
  capacity_left: number;
  /** `capacity_left > 0`, not in the past and within the horizon. */
  available: boolean;
}

/** `GET /api/guest/slots?item_id=&date=` — availability for one day. */
export interface GuestSlotAvailability {
  date: string;
  duration_minutes: number;
  capacity: number;
  slots: GuestSlot[];
}

export type OrderTiming = 'asap' | 'scheduled';

export interface OrderLinePayload {
  item_id: string;
  quantity: number;
  modifier_option_ids?: string[];
  comment?: string;
}

/**
 * One payload for both types (contract §4). A request-service is the same body
 * with a single line and `field_values` filled in; location keys are omitted
 * entirely when the item's `location_mode` is not `delivery`.
 */
export interface CreateOrderPayload {
  lines: OrderLinePayload[];
  location_id?: string;
  location_refinement?: string;
  delivery_mode?: string;
  timing: OrderTiming;
  requested_time: string | null;
  comment: string;
  /** `code` → answer. Empty for a product order. */
  field_values?: Record<string, string | number>;
  /** Start of the booked interval — required only for a `slot` offering. */
  slot_start?: string;
  /** Custom tip in minor units. Mutually exclusive with `tip_percent`. */
  tip_minor?: number;
  /** Preset tip as a percentage of the subtotal. Mutually exclusive with `tip_minor`. */
  tip_percent?: number;
}

/**
 * `POST /cart/quote` — THE only source of every charge and of the grand total the
 * cart shows. The client never computes any of these values itself; a change to
 * the cart, the tip or the location re-requests this. Body is the order payload.
 */
export interface CartQuote {
  subtotal_minor: number;
  service_fee_minor: number;
  tax_minor: number;
  delivery_fee_minor: number;
  tip_minor: number;
  /** The grand total to display — never recomputed on the client. */
  total_minor: number;
  /** When true, tax is already inside the prices — shown as informational only. */
  tax_inclusive: boolean;
  currency: string;
  /** Order minimum in minor units, or `null` when the hotel sets none. */
  minimum_minor: number | null;
  below_minimum: boolean;
  shortfall_minor: number;
  /** Percentage tip presets, e.g. `[5, 10, 15]`. */
  tip_presets: number[];
}

/** Server-computed charge breakdown carried by a serialized order. */
export interface OrderCharges {
  subtotal_minor: number;
  service_fee_minor: number;
  tax_minor: number;
  tax_inclusive: boolean;
  delivery_fee_minor: number;
  tip_minor: number;
  total_minor: number;
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
  /** `null` when the item carries no price. */
  unit_price: number | null;
  line_total: number | null;
  comment: string;
  image_url: string | null;
  modifiers: OrderModifier[];
}

/**
 * The booked slot of a `booking` order. Non-empty only for a slot offering;
 * the storefront and the tracker draw the card body from it, the same way a
 * request draws its body from `field_values` — by the presence of the block,
 * never by the type string.
 */
export interface OrderSlot {
  resource_title: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
}

/**
 * A snapshot of one answer of a request form: it must survive the field being
 * renamed or deleted in the CMS, exactly like the price snapshot on a line.
 */
export interface OrderFieldValue {
  code: string;
  label: string;
  field_type: RequestFieldType;
  value: string | number | null;
  /** Ready-to-print value — the UI never formats an answer itself. */
  display: string;
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
  /** `cart` for food, `request` for a service, `booking` for a slot. */
  type?: 'cart' | 'request' | 'booking';
  /** `null` when nothing in the order is priced — show a dash, never "0 ₽". */
  total: number | null;
  currency: string;
  /** Server-computed charge breakdown (fee / tax / delivery / tip / total). */
  charges?: OrderCharges | null;
  /** ISO datetime with the hotel-TZ offset — the promised serve time. */
  serve_by?: string | null;
  /** Non-empty only for a request-service. */
  field_values?: OrderFieldValue[];
  /** Present only for a `booking` order — the reserved slot. */
  slot?: OrderSlot | null;
  items: OrderItem[];
  /**
   * The guest may leave a review: terminal, not cancelled, no review yet, and the
   * hotel collects them. Purely a server verdict — the storefront never computes it.
   */
  can_review?: boolean;
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

/* ── Home ──────────────────────────────────────────────────────────────── */

/**
 * One tile of the home screen, assembled by the server FROM DATA: a section only
 * appears when the hotel has active categories of that type. The client learns
 * the destination from `route` and the tile kind from `type` via the behaviour
 * registry — never from comparing the type string.
 */
export interface GuestHomeSection {
  type: OfferingType;
  code: string;
  title: string;
  category_count: number;
  route: string;
}

/**
 * One quick-action tile of the home screen. The server names a Material Symbols
 * icon and a route; the client renders the icon through its own icon registry and
 * prefers an i18n label over `title`, which is only a fallback.
 */
export interface GuestQuickAction {
  code: string;
  route: string;
  /** Material Symbols name (e.g. `restaurant`, `room_service`, `event_available`). */
  icon: string;
  /** Fallback label — used only when no i18n key `guest.quickActions.<code>` exists. */
  title: string;
}

export interface GuestHome {
  hotel: { name: string; theme?: PartialBrandTokens };
  room: string | null;
  sections: GuestHomeSection[];
  /** Quick-action tiles rendered above the sections. */
  quick_actions?: GuestQuickAction[];
  /** Unread messages from staff — drives the chat tab badge. */
  unread_chat: number;
}

/* ── Active orders (home strip) ────────────────────────────────────────────── */

/** Status subset carried by an active-order row (contract §orders/active). */
export interface GuestActiveOrderStatus {
  code: string;
  title: string;
  /** Palette token (`info`/`warning`/`success`/`danger`) → status dot color. */
  color_token?: string;
}

/**
 * One row of the home active-order strip — a light projection of a live order.
 * `serve_by` is an ISO datetime carrying the hotel-TZ offset; the strip formats
 * its wall-clock `HH:MM` directly from that offset.
 */
export interface GuestActiveOrder {
  id: string;
  number: number;
  type?: 'cart' | 'request' | 'booking';
  status: GuestActiveOrderStatus;
  serve_by: string | null;
  total: number | null;
  currency: string;
  /** Short composition, already localized (e.g. «Стейк рибай, Паста карбонара»). */
  summary: string;
  /** How many further lines beyond `summary` — drives the «ещё N» tail. */
  extra_count: number;
}

export interface GuestActiveOrders {
  orders: GuestActiveOrder[];
}

/* ── Chat ──────────────────────────────────────────────────────────────── */

export interface ChatMessage {
  id: string;
  author_type: 'guest' | 'staff';
  author_name: string;
  body: string;
  created_at: string;
  /** Computed by the server per requesting side: the guest's own messages, or staff's. */
  mine: boolean;
}

/**
 * Full thread snapshot — the body of `GET /api/guest/chat` and of every chat
 * WebSocket frame. The client only ever REPLACES its cache with this; it never
 * appends a delta, exactly like the order/board snapshots.
 */
export interface ChatSnapshot {
  thread_id: string;
  room: string | null;
  messages: ChatMessage[];
  /** Unread for the requesting side. */
  unread: number;
}

/** WebSocket envelope for chat — `{type, event, thread}` (reconciliation only). */
export interface ChatSnapshotMessage {
  type: 'chat.snapshot';
  event?: string;
  thread: ChatSnapshot;
}

/* ── Reviews ───────────────────────────────────────────────────────────── */

export interface GuestReview {
  rating: number;
  comment: string;
  created_at?: string;
}
