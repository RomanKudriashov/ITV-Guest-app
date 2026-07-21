/**
 * Types mirroring `docs/cms-api-contract.md` (прогон 2).
 * Money is always an integer in the currency's minor units (копейки).
 */

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

export interface Item {
  id: string;
  category_id: string;
  code: string;
  title: Translated;
  description?: Translated;
  /** Minor units. */
  price: number;
  images: MediaAsset[];
  flags: string[];
  allergens: string[];
  schedule_id?: string | null;
  sort_order: number;
  is_active: boolean;
  in_stock: boolean;
  modifier_groups?: ModifierGroup[];
}

export interface ItemPayload {
  category_id: string;
  title: Translated;
  description?: Translated;
  code?: string;
  price: number;
  flags?: string[];
  allergens?: string[];
  schedule_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
  in_stock?: boolean;
}

export interface ReorderEntry {
  id: string;
  sort_order: number;
}
