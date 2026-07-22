/**
 * ============================================================================
 * OFFERING BEHAVIOUR REGISTRY — the frontend twin of `apps/catalog/offerings.py`
 * ============================================================================
 *
 * Read `docs/offering-types.md` before touching this file.
 *
 * There is ONE guest flow, ONE order, ONE tracker board and ONE CMS editor.
 * A type never gets its own screen. It only decides:
 *
 *   1. what the guest fills in   — cart lines, a form of fields, a slot to book,
 *                                  or nothing at all (a read-only page);
 *   2. what a card body shows    — line items, field answers or a booked slot;
 *   3. which checks apply        — required modifiers, required fields, a slot.
 *
 * Application code asks the registry for a FLAG, it never compares the type
 * string:
 *
 *     const behaviour = behaviourFor(item.type);
 *     if (behaviour.usesFields) { ... }        // NOT: if (item.type === 'service_request')
 *
 * Adding a type (`info`, `slot`) must mean adding a row here — if it needs a new
 * screen instead, the model cracked, not the type.
 */

export type OfferingType = 'product' | 'service_request' | 'info' | 'slot';

/** How the storefront treats the delivery location for an offering. */
export type LocationMode = 'delivery' | 'room' | 'none';

export interface OfferingBehaviour {
  type: OfferingType;
  /**
   * Does interacting with this offering create an `Order`? `info` is the single
   * type that does not: it is a read-only page (Wi-Fi, rules, hotel facts). This
   * is the one flag the guest flow branches on to hide the order controls.
   */
  createsOrder: boolean;
  /** Shape of the resulting order, or `null` when the offering makes none. */
  orderType: 'cart' | 'request' | 'booking' | null;
  /** May the guest put several lines into one order? */
  allowsMultipleLines: boolean;
  /** Modifier groups in the CMS and in the item sheet. */
  usesModifiers: boolean;
  /** Request fields in the CMS and a form instead of the cart in the storefront. */
  usesFields: boolean;
  /** A translatable `content` body in the CMS and a read-only page for the guest. */
  usesContent: boolean;
  /** A `SlotConfig` in the CMS and a date → slot picker for the guest. */
  usesSlots: boolean;
  /** Does the editor expose the location-mode control (delivery vs room)? */
  configuresLocation: boolean;
  /** Default `location_mode` for a freshly created item; the hotel may override. */
  defaultLocationMode: LocationMode;
  /**
   * `always` — the price is mandatory; `optional` — `null` means "not priced";
   * `never` — the offering has no price at all and the field is hidden.
   */
  priced: 'always' | 'optional' | 'never';
  /** Prefix of the guest row/tile testid: `guest-item-<code>` / `guest-slot-<code>`. */
  guestTestIdPrefix: string;
  /** Root testid of the storefront catalog screen for this type. */
  guestCatalogTestId: string;
  /** The guest collects these items in the cart before checking out. */
  usesCart: boolean;
  /** i18n namespace of the storefront catalog wording for this type. */
  guestCatalogNamespace: string;
}

const BEHAVIOURS: Record<OfferingType, OfferingBehaviour> = {
  product: {
    type: 'product',
    createsOrder: true,
    orderType: 'cart',
    allowsMultipleLines: true,
    usesModifiers: true,
    usesFields: false,
    usesContent: false,
    usesSlots: false,
    configuresLocation: true,
    defaultLocationMode: 'delivery',
    priced: 'always',
    guestTestIdPrefix: 'guest-item',
    guestCatalogTestId: 'guest-menu',
    usesCart: true,
    guestCatalogNamespace: 'guest.menu',
  },
  service_request: {
    type: 'service_request',
    createsOrder: true,
    orderType: 'request',
    allowsMultipleLines: false,
    usesModifiers: false,
    usesFields: true,
    usesContent: false,
    usesSlots: false,
    configuresLocation: true,
    defaultLocationMode: 'room',
    priced: 'optional',
    guestTestIdPrefix: 'guest-service',
    guestCatalogTestId: 'guest-services',
    usesCart: false,
    guestCatalogNamespace: 'guest.services',
  },
  info: {
    type: 'info',
    // The ONE offering with no order: a read-only page, invisible to the tracker.
    createsOrder: false,
    orderType: null,
    allowsMultipleLines: false,
    usesModifiers: false,
    usesFields: false,
    usesContent: true,
    usesSlots: false,
    configuresLocation: false,
    defaultLocationMode: 'none',
    priced: 'never',
    guestTestIdPrefix: 'guest-info',
    guestCatalogTestId: 'guest-info-catalog',
    usesCart: false,
    guestCatalogNamespace: 'guest.info',
  },
  slot: {
    type: 'slot',
    createsOrder: true,
    orderType: 'booking',
    allowsMultipleLines: false,
    usesModifiers: false,
    usesFields: false,
    usesContent: false,
    usesSlots: true,
    configuresLocation: false,
    defaultLocationMode: 'none',
    priced: 'optional',
    guestTestIdPrefix: 'guest-slot',
    guestCatalogTestId: 'guest-slot-catalog',
    usesCart: false,
    guestCatalogNamespace: 'guest.slot',
  },
};

export const OFFERING_TYPES: OfferingType[] = ['product', 'service_request', 'info', 'slot'];

export function isOfferingType(value: unknown): value is OfferingType {
  return typeof value === 'string' && value in BEHAVIOURS;
}

/**
 * Behaviour of a type. An unknown or missing type falls back to `product`:
 * an older backend that does not send `type` yet still serves food correctly.
 */
export function behaviourFor(type: string | null | undefined): OfferingBehaviour {
  return isOfferingType(type) ? BEHAVIOURS[type] : BEHAVIOURS.product;
}

export const LOCATION_MODES: LocationMode[] = ['delivery', 'room', 'none'];

export function isLocationMode(value: unknown): value is LocationMode {
  return value === 'delivery' || value === 'room' || value === 'none';
}

/**
 * Does the storefront have to ask "where to?" — the ONLY question about
 * location anywhere in the guest flow.
 */
export function asksForLocation(mode: string | null | undefined): boolean {
  return (isLocationMode(mode) ? mode : 'delivery') === 'delivery';
}
