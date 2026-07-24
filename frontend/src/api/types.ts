/**
 * Types mirroring `docs/cms-api-contract.md`.
 * Money is always an integer in the currency's minor units (копейки).
 */

import type { LocationMode, OfferingType } from '@/offerings/behaviour';
import type { RequestFieldType } from '@/offerings/requestFields';

/** Translatable field: `{"ru": "Горячее", "en": "Hot"}`. Empty languages absent. */
export type Translated = Record<string, string>;

export type MediaKind = 'item' | 'category' | 'brand';
export type MediaStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface MediaAsset {
  id: string;
  url: string;
  thumb_url?: string;
  status: MediaStatus;
  original_filename?: string;
  sort_order?: number;
}

export interface StaffUser {
  id: string;
  email: string;
  full_name: string;
  is_hotel_admin: boolean;
  language: string;
}

export interface HotelInfo {
  id: string;
  name: string;
  subdomain: string;
  currency: string;
  currency_minor_units: number;
  timezone: string;
  default_language: string;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  user: StaffUser;
}

export interface MeResponse {
  user?: StaffUser;
  hotel?: HotelInfo;
  /** Some backends flatten the user onto the root — tolerated by `normalizeMe`. */
  id?: string;
  email?: string;
  full_name?: string;
  is_hotel_admin?: boolean;
  language?: string;
}

export interface LanguageOption {
  code: string;
  title: string;
  is_default?: boolean;
}

export interface TaxonomyOption {
  code: string;
  title: Translated;
}

export interface ExecutionPoint {
  id: string;
  code: string;
  title: Translated;
}

export type DayPart = string;

export interface ScheduleInterval {
  id?: string;
  /** 0 — Monday … 6 — Sunday. */
  weekday: number;
  /** `HH:MM`, hotel-local. */
  start_time: string;
  end_time: string;
  day_part?: DayPart | null;
}

export interface Schedule {
  id: string;
  name: string;
  is_always_open: boolean;
  intervals: ScheduleInterval[];
}

export interface SchedulePayload {
  name: string;
  is_always_open?: boolean;
  intervals: ScheduleInterval[];
}

export interface Bootstrap {
  hotel: HotelInfo;
  languages: LanguageOption[];
  flags: TaxonomyOption[];
  allergens: TaxonomyOption[];
  schedules: Schedule[];
  execution_points: ExecutionPoint[];
  day_parts: DayPart[];
}

export interface Category {
  id: string;
  parent_id: string | null;
  code: string;
  title: Translated;
  description?: Translated;
  image?: MediaAsset | null;
  schedule_id?: string | null;
  sort_order: number;
  is_active: boolean;
  items_count?: number;
  /** Commerce: whether the service fee applies to this category. */
  service_fee_applies?: boolean;
  /** Commerce: minimum order amount, minor units; `null` — no minimum. */
  min_order_minor?: number | null;
  children?: Category[];
}

export interface CategoryPayload {
  title: Translated;
  description?: Translated;
  code?: string;
  parent_id?: string | null;
  image_id?: string | null;
  schedule_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
  /** Commerce: whether the service fee applies to this category. */
  service_fee_applies?: boolean;
  /** Commerce: minimum order amount, minor units; `null` — no minimum. */
  min_order_minor?: number | null;
}

export interface CategoryReorderEntry {
  id: string;
  parent_id: string | null;
  sort_order: number;
}

export type ModifierSelection = 'single' | 'multi';

export interface ModifierOption {
  id: string;
  code?: string;
  title: Translated;
  /** Minor units; may be negative. */
  price_delta: number;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface ModifierOptionPayload {
  title: Translated;
  code?: string;
  price_delta?: number;
  is_default?: boolean;
  is_active?: boolean;
  sort_order?: number;
}

export interface ModifierGroup {
  id: string;
  item_id?: string;
  code?: string;
  title: Translated;
  selection: ModifierSelection;
  is_required: boolean;
  min_choices: number;
  max_choices: number;
  sort_order: number;
  options: ModifierOption[];
}

export interface ModifierGroupPayload {
  title: Translated;
  code?: string;
  selection?: ModifierSelection;
  is_required?: boolean;
  min_choices?: number;
  max_choices?: number;
  sort_order?: number;
}

/** One option of a `select` request field (contract §5a). */
export interface RequestFieldOption {
  value: string;
  label: Translated;
}

/**
 * A field of a request form — the counterpart of a modifier group, and present
 * only on items whose behaviour `usesFields`.
 */
export interface RequestField {
  id: string;
  item_id?: string;
  code?: string;
  label: Translated;
  help_text?: Translated;
  field_type: RequestFieldType;
  is_required: boolean;
  options?: RequestFieldOption[];
  min_value?: number | null;
  max_value?: number | null;
  sort_order: number;
}

export interface RequestFieldPayload {
  label: Translated;
  help_text?: Translated;
  code?: string;
  field_type: RequestFieldType;
  is_required?: boolean;
  options?: RequestFieldOption[];
  min_value?: number | null;
  max_value?: number | null;
  sort_order?: number;
}

export interface Item {
  id: string;
  category_id: string;
  code: string;
  /** Set at creation and immutable afterwards (`422 type_immutable`). */
  type?: OfferingType;
  location_mode?: LocationMode;
  title: Translated;
  description?: Translated;
  /** Body of an `info` offering — translatable markup-ish text. */
  content?: Translated;
  /** Minor units; `null` — "price not set". */
  price: number | null;
  images: MediaAsset[];
  /** Allergens/markers assigned from the tenant dictionaries (join). */
  allergen_ids?: string[];
  marker_ids?: string[];
  /** Ordered name→value characteristics. */
  characteristics?: CmsCharacteristic[];
  schedule_id?: string | null;
  sort_order: number;
  is_active: boolean;
  in_stock: boolean;
  /** Preparation/serving time, minutes; `null` — not set. */
  prep_minutes?: number | null;
  /** Marketing badges assigned to the item, in display order. */
  badges?: ItemBadgeLink[];
  modifier_groups?: ModifierGroup[];
  request_fields?: RequestField[];
}

/** One entry of the allergen / dietary-marker tenant dictionary. */
export interface DictEntry {
  id: string;
  code: string;
  title: Translated;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface DictEntryPayload {
  title: Translated;
  code?: string;
  is_active?: boolean;
  sort_order?: number;
}

export interface CmsCharacteristic {
  name: Translated;
  value: Translated;
}

export interface ItemPayload {
  category_id: string;
  title: Translated;
  description?: Translated;
  /** Body of an `info` offering; empty languages are dropped before sending. */
  content?: Translated;
  code?: string;
  /** Only ever sent on creation — the server rejects a change of type. */
  type?: OfferingType;
  location_mode?: LocationMode;
  price: number | null;
  allergen_ids?: string[];
  marker_ids?: string[];
  characteristics?: CmsCharacteristic[];
  schedule_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
  in_stock?: boolean;
  /** Preparation/serving time, minutes; `null` — not set. */
  prep_minutes?: number | null;
}

export interface ReorderEntry {
  id: string;
  sort_order: number;
}

/**
 * Configuration of a bookable (`slot`) item — a OneToOne to the item. Slots are
 * built from `schedule_id`'s working hours cut into `duration_minutes` pieces;
 * `execution_point_id` is the department that fulfils the booking.
 */
export interface SlotConfig {
  id?: string;
  item_id?: string;
  duration_minutes: number;
  capacity: number;
  schedule_id: string | null;
  execution_point_id: string | null;
  lead_minutes: number;
  horizon_days: number;
}

export interface SlotConfigPayload {
  duration_minutes: number;
  capacity: number;
  schedule_id: string | null;
  execution_point_id: string | null;
  lead_minutes: number;
  horizon_days: number;
}

/* ── Commerce settings ─────────────────────────────────────────────────── */

/**
 * Hotel-wide commerce configuration. `*_bp` are basis points (10000 = 100 %);
 * money fields are integer minor units. `currency` / `currency_minor_units`
 * are read-only echoes so the UI can format amounts.
 */
export interface CommerceSettings {
  service_fee_bp: number;
  tax_bp: number;
  tax_inclusive: boolean;
  /** Tip presets as integer percents (0..100). */
  tip_presets: number[];
  /** Minor units; `null` — no free-delivery threshold. */
  free_delivery_threshold_minor: number | null;
  /** Rounding step in minor units; 0/1 — no rounding. */
  price_round_to_minor: number;
  currency: string;
  currency_minor_units: number;
}

/** PATCH payload — only changed keys are sent. */
export type CommerceSettingsPayload = Partial<
  Pick<
    CommerceSettings,
    | 'service_fee_bp'
    | 'tax_bp'
    | 'tax_inclusive'
    | 'tip_presets'
    | 'free_delivery_threshold_minor'
    | 'price_round_to_minor'
  >
>;

/* ── Marketing badges ──────────────────────────────────────────────────── */

/** The four supported badge palette roles. */
export type BadgeColorRole = 'accent' | 'gold' | 'success' | 'info';

export interface Badge {
  id: string;
  label: Translated;
  color_role: BadgeColorRole;
  sort_order: number;
  is_active: boolean;
  /** Non-null for seeded presets (Хит/Новинка/…); read-only marker. */
  preset?: string | null;
}

export interface BadgePayload {
  label: Translated;
  color_role: BadgeColorRole;
  sort_order?: number;
  is_active?: boolean;
}

/** One badge assigned to an item — id + display order. */
export interface ItemBadgeLink {
  id: string;
  sort_order: number;
}

/* ── Quick actions ─────────────────────────────────────────────────────── */

/** One entry of the server-provided quick-action dictionary. */
export interface QuickActionOption {
  code: string;
  route: string;
  /** Material Symbols icon name from the server dictionary. */
  icon: string;
  title: Translated;
}

export interface QuickActions {
  available: QuickActionOption[];
  /** Ordered list of selected codes. */
  selected: string[];
}

/** One tile in the CMS showcase editor (includes hotel-hidden tiles). */
export interface CmsShowcaseTile {
  key: string;
  type: string;
  title: string;
  size: 's' | 'm' | 'l';
  order: number;
  /** Shown on the guest home (CMS visibility toggle). */
  shown: boolean;
  /** Active/clickable tile (false for the room-control stub). */
  enabled: boolean;
  venue_count: number | null;
}

export interface ShowcaseSettings {
  group_threshold: number;
  tiles: CmsShowcaseTile[];
}

export interface ShowcaseSavePayload {
  group_threshold?: number;
  tiles?: { key: string; size?: string; sort_order?: number; is_enabled?: boolean }[];
}
