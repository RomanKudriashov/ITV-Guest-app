/** Shared storefront-shell constants (kept apart so GuestLayout ↔ CartPage
 *  don't form an import cycle). */

export const BOTTOM_NAV_HEIGHT = 60;
/** Desktop starts at 1024 (spec §4); below it the rail would eat the content. */
export const DESKTOP_QUERY = '(min-width:1024px)';
/** Rail + content are capped so the storefront never stretches indefinitely. */
export const RAIL_WIDTH = 236;
export const CONTENT_MAX = 1080;
export const CART_WIDTH = 328;
