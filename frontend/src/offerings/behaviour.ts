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
 *   1. what the guest fills in   — cart lines or a form of fields;
 *   2. what a card body shows    — line items or field answers;
 *   3. which checks apply        — required modifiers or required fields.
 *
 * Application code asks the registry for a FLAG, it never compares the type
 * string:
 *
 *     const behaviour = behaviourFor(item.type);
 *     if (behaviour.usesFields) { ... }        // NOT: if (item.type === 'service_request')
 *
 * Adding a type (`info`, `slot_booking`) must mean adding a row here — if it
 * needs a new screen instead, the model cracked, not the type.
 */

export type OfferingType = 'product' | 'service_request';

/** How the storefront treats the delivery location for an offering. */
export type LocationMode = 'delivery' | 'room' | 'none';

export interface OfferingBehaviour {
  type: OfferingType;
  /** Shape of the resulting order: a basket or a single request. */
  orderType: 'cart' | 'request';
  /** May the guest put several lines into one order? */
  allowsMultipleLines: boolean;
  /** Modifier groups in the CMS and in the item sheet. */
  usesModifiers: boolean;
  /** Request fields in the CMS and a form instead of the cart in the storefront. */
  usesFields: boolean;
  /** Default `location_mode` for a freshly created item; the hotel may override. */
  defaultLocationMode: LocationMode;
  /** `always` — the price is mandatory; `optional` — `null` means "not priced". */
  priced: 'always' | 'optional';
  /** Prefix of the guest row/tile testid: `guest-item-<code>` / `guest-service-<code>`. */
  guestTestIdPrefix: string;
  /** The guest collects these items in the cart before checking out. */
  usesCart: boolean;
  /** i18n namespace of the storefront catalog wording for this type. */
  guestCatalogNamespace: string;
}

const BEHAVIOURS: Record<OfferingType, OfferingBehaviour> = {
  product: {
    type: 'product',
    orderType: 'cart',
    allowsMultipleLines: true,
    usesModifiers: true,
    usesFields: false,
    defaultLocationMode: 'delivery',
    priced: 'always',
    guestTestIdPrefix: 'guest-item',
    usesCart: true,
    guestCatalogNamespace: 'guest.menu',
  },
  service_request: {
    type: 'service_request',
    orderType: 'request',
    allowsMultipleLines: false,
    usesModifiers: false,
    usesFields: true,
    defaultLocationMode: 'room',
    priced: 'optional',
    guestTestIdPrefix: 'guest-service',
    usesCart: false,
    guestCatalogNamespace: 'guest.services',
  },
};

export const OFFERING_TYPES: OfferingType[] = ['product', 'service_request'];

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
