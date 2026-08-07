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
  /**
   * Обложка отеля для парадной главной (R5) — из «Бренд и витрина» (R4).
   * Готовый url: витрина не резолвит ассеты и не собирает адреса строкой.
   */
  cover_image?: string | null;
  /**
   * Включён ли у отеля модуль «Управление номером».
   *
   * УЗКИЙ флаг, а не список модулей: гостю незачем знать платный обвес отеля.
   * Отвечает ровно на один вопрос — показывать ли пункт «Номер».
   */
  room_control_enabled?: boolean;
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
  /** Allergens («contains») — localized dictionary entries, ordered. Empty → omit. */
  allergens: ItemFacet[];
  /** Dietary markers («suitable») — localized, rendered as green pills. Empty → omit. */
  markers?: ItemFacet[];
  /** Ordered name→value characteristics («Cooking → Grill»). Empty → omit. */
  characteristics?: ItemCharacteristic[];
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
    /** Portion in grams — shown inline in the КБЖУ line. */
    portion?: number;
    composition?: string;
  } | null;
}

/** One allergen or dietary-marker entry, localized to the request language. */
export interface ItemFacet {
  code: string;
  title: string;
  sort_order?: number;
}

export interface ItemCharacteristic {
  name: string;
  value: string;
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

/**
 * Кто это заведение — приходит, когда каталог сужен на него (R5).
 *
 * `type` решает, какой блок контента рисует витрина, и это ТОТ ЖЕ тип, из
 * которого выводится вид трекера у персонала (R3): один источник правды на
 * гостевую и рабочую стороны.
 */
export interface VenueIdentity {
  code: string;
  type: string;
  title: string;
  tagline: string;
  image: string | null;
  is_open: boolean;
  available_until: string | null;
  available_from: string | null;
}

/** `GET /api/guest/catalog?type=…` — one envelope for every offering type. */
export interface GuestCatalog {
  language: string;
  server_time?: string;
  /** Venue photo for the catalog hero; null → fall back to the brand background. */
  hero_image?: string | null;
  /** Заполнен при скоупе на заведение; null — общий каталог отеля. */
  venue?: VenueIdentity | null;
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
  /**
   * Заведение, чья это корзина. Решает и коммерцию (сбор/минимум/доставка),
   * и разъезд заказа по исполнителям, если заведение заимствует чужой контент.
   */
  service_code?: string;
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
  /**
   * ЧЕМ КАРТОЧКА ОТВЕЧАЕТ ГОСТЮ — из реестра сервера, а не из догадки клиента.
   *
   * `booking` — запись по слоту (когда сеанс, сколько длится, где);
   * `delivery` — доставка (куда, когда, ожидаемое время);
   * `ride` — поездка (подача, откуда, куда);
   * `request` — заявка (что просили, когда приняли, статус).
   *
   * Считается там же, где тип трекера персонала: у гостя и у стойки один
   * источник правды о том, что это за заявка.
   */
  card_kind?: 'booking' | 'delivery' | 'ride' | 'request';
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

/** Open/closed status of a venue, computed server-side in the hotel timezone. */
export interface GuestVenueStatus {
  state: 'open' | 'closed';
  /** Localised only for the pill: closing time when open (e.g. "23:00"). */
  until: string | null;
  /** Next opening time when closed (e.g. "07:00"). */
  opens_at: string | null;
}

export type ShowcaseTileType = 'venue' | 'service-category' | 'info' | 'room-control';
export type ShowcaseTileSize = 's' | 'm' | 'l';

/**
 * One bento tile of the home showcase, assembled server-side FROM DATA. The tile
 * kind drives its anatomy; `route` is the destination (null → disabled stub). The
 * client renders `image`, or falls back to a brand/gradient cover when it is null.
 */
export interface GuestShowcaseTile {
  key: string;
  type: ShowcaseTileType;
  title: string;
  subtitle: string | null;
  kind: string | null;
  /** Number of venues collapsed into a `service-category` tile. */
  venue_count: number | null;
  status: GuestVenueStatus | null;
  image: string | null;
  /** Up to 4 cover previews shown inside a collapsed category tile. */
  cover_previews: string[];
  route: string | null;
  size: ShowcaseTileSize;
  order: number;
  enabled: boolean;
}

/** One venue card on the level-2 list (contract §1 «Уровень 2»). */
export interface GuestVenue {
  code: string;
  title: string;
  subtitle: string | null;
  kind: string | null;
  image: string | null;
  status: GuestVenueStatus | null;
  route: string;
}

export interface GuestVenueList {
  group: string;
  title: string;
  venues: GuestVenue[];
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
  hotel: { name: string; subdomain?: string; theme?: PartialBrandTokens };
  room: string | null;
  /** Bento showcase of hotel services, ordered by the server. */
  tiles: GuestShowcaseTile[];
  /** Kept for the CMS/back-compat; the bento home does not render a separate row. */
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

/* ── Управление номером (GRMS) ──────────────────────────────────────────────
 *
 * Фронт знает про `controlId` и значение, и больше ни про что. Номер комнаты,
 * endpoint, имя устройства iRidi, имена команд и обратной связи сюда не
 * приезжают — это не «пока не добавили», а условие контракта
 * (docs/grms/contracts/guest-api.md §8).
 */

/** Ветвление идёт ПО ЭТОМУ, никогда по `kind` и никогда по `controlId`. */
export type RoomCapability =
  | 'toggle'
  | 'trigger'
  | 'fan_speed'
  | 'setpoint'
  | 'current_temp'
  | 'position'
  | 'level';

export type RoomControlState = 'confirmed' | 'pending' | 'offline';

export interface RoomRange {
  min: number;
  max: number;
  step: number;
}

export interface RoomControl {
  controlId: string;
  /** Только для иконки и заголовка по умолчанию. В условиях поведения — нет. */
  kind: string;
  title: string;
  /**
   * Код глифа ИЗ КАТАЛОГА СЕРВЕРА: зона, сцена, вид элемента. Реестр глифов
   * живёт на фронте, выбор — на сервере. Неизвестный код падает на умолчание,
   * поэтому новый вид элемента не ломает экран.
   */
  icon?: string;
  /**
   * Готовые ЛОКАЛИЗОВАННЫЕ подписи состояния: у шторы «открыта», у блэкаута
   * «закрыт», у «не беспокоить» — «персонал не побеспокоит». Фронт их не
   * придумывает: отличить один элемент от другого он мог бы только разбором
   * `controlId`, а это ключ, а не признак типа.
   */
  labels?: { on?: string; off?: string };
  /**
   * Короткая подпись элемента («всё готово ко сну») — ЛОКАЛИЗОВАННАЯ, с
   * сервера. У четырёх сцен один `kind`, и различает их ровно то, что прислал
   * сервер: глиф, название и эта строка. Пусто — карточка обходится названием.
   */
  hint?: string;
  capabilities: RoomCapability[];
  /**
   * Скаляр у простого элемента, объект у составного (кондиционер — ОДИН
   * элемент на четыре ручки). `null` — значения нет: элемент недоступен,
   * в процессе, или это сцена, у которой состояния не бывает.
   */
  value: number | Record<string, number> | null;
  range?: Partial<Record<RoomCapability, RoomRange>>;
  state: RoomControlState;
  readonly: boolean;
}

export interface RoomZone {
  code: string;
  title: string;
  controls: RoomControl[];
}

/** Прямоугольник плана в ПРОЦЕНТАХ от кадра. Пикселей здесь нет и не будет. */
export interface RoomPlanRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomPlanZone {
  code: string;
  /** Элемент, которым управляет тап по комнате. Разбирать строкой нельзя. */
  controlId: string;
  /** Область нажатия. */
  hit: RoomPlanRect;
  /** Область затемнения — шире хита под растушёвку градиента. */
  mask: RoomPlanRect;
}

export interface RoomPlanWindow extends RoomPlanRect {
  code: string;
  /** Вертикальное окно на боковой стене собирает полотна вверх и вниз. */
  orientation: 'horizontal' | 'vertical';
  curtainId: string;
  /** Отдельный слой на том же окне. Пусто — блэкаута на этом окне нет. */
  blackoutId: string;
}

/** Точка на плане: пока это выход воздуха фанкойла. */
export interface RoomPlanPoint {
  controlId: string;
  x: number;
  y: number;
  /**
   * Куда дует точка воздуха. Приезжает РАЗМЕТКОЙ: фанкойл висит на стене, и в
   * какую сторону от неё идёт струя, знает тот, кто размечал план. Точкам
   * света поле безразлично.
   */
  dir?: 'up' | 'down' | 'left' | 'right';
}

/**
 * План-двойник номера. Приезжает ГОТОВЫМ: URL собрал сервер, координаты
 * замерены по рендеру. Ключа нет вовсе — у типа номера плана нет, и экран
 * работает списком контролов.
 */
export interface RoomPlan {
  /** Светлый кадр: показывается только там, где свет подтверждённо включён. */
  image: string;
  /**
   * Ночной кадр, посчитанный из светлого и совмещённый с ним попиксельно.
   * Пусто — ночного кадра у типа нет, и плита работает затемняющей маской.
   */
  image_off: string;
  aspect: number | null;
  /**
   * Зеркальная планировка: комната напротив по коридору — та же, отражённая.
   * Отражается плита целиком, кадры вместе с геометрией. Это свойство КОМНАТЫ,
   * а не раскладки: с RTL оно не связано никак.
   */
  mirrored?: boolean;
  zones: RoomPlanZone[];
  windows: RoomPlanWindow[];
  points: RoomPlanPoint[];
}

export interface RoomStateSnapshot {
  availability: 'online' | 'unavailable';
  /** Готовый текст для гостя. Техническая причина остаётся на сервере. */
  message: string | null;
  checked_at: string;
  trust: GuestTrust;
  can_command: boolean;
  zones: RoomZone[];
  plan?: RoomPlan;
}

export interface RoomCommandAccepted {
  commandId: string;
  controlId: string;
  state: 'pending';
}

/** Исход конкретной команды, доносимый вместе со снимком по WS. */
export interface RoomCommandOutcome {
  commandId: string;
  controlId: string;
  result: 'confirmed' | 'unconfirmed' | 'accepted' | 'failed' | null;
}
