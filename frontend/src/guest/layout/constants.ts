/** Shared storefront-shell constants (kept apart so GuestLayout ↔ CartPage
 *  don't form an import cycle). */

export const BOTTOM_NAV_HEIGHT = 60;
/**
 * Отступ плавающего нижнего меню от краёв экрана.
 *
 * Меню больше не полоса во всю ширину: оно скруглено со всех сторон, а значит
 * обязано от чего-то отступать. Число лежит здесь, потому что от него зависят
 * двое: сам шелл, который меню рисует, и контент, который резервирует место
 * под ним, — разъехавшись, они дали бы либо щель, либо кнопку под меню.
 */
export const BOTTOM_NAV_INSET = 12;
/**
 * Сколько места занимает нижнее меню целиком — высота плюс отступы.
 *
 * Спрашивают все, кому нужно «не залезть под меню»: контент шелла, липкие
 * подвалы каталога и корзины, высота чата, нижний запас экрана номера. Раньше
 * они складывали высоту с чем придётся по месту, и после превращения полосы в
 * плавающий блок каждое такое место разъехалось бы по-своему.
 */
export const BOTTOM_NAV_SPACE = BOTTOM_NAV_HEIGHT + BOTTOM_NAV_INSET * 2;
/** Desktop starts at 1024 (spec §4); below it the rail would eat the content. */
export const DESKTOP_QUERY = '(min-width:1024px)';
export const CONTENT_MAX = 1080;
export const CART_WIDTH = 328;
