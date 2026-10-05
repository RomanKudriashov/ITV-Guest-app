/**
 * ЧАСТЬ «ВИТРИНА ГОСТЯ» — всё, что качает телефон по QR.
 *
 * Роутер берёт экраны отсюда лениво (`app/lazyPart.tsx`), поэтому сборщик
 * выносит их в отдельный файл. Сюда — только экраны гостя: импорт панели,
 * трекера или консоли притянул бы их код к гостю, и это ловит сторож сборки
 * `scripts/check-guest-bundle.mjs`.
 */
export { GuestRoot } from '@/guest/GuestRoot';
export { GuestLayout } from '@/guest/layout/GuestLayout';
export { EntryPage } from '@/guest/pages/EntryPage';
export { HomePage } from '@/guest/pages/HomePage';
export { CatalogPage } from '@/guest/pages/CatalogPage';
export { VenuePage } from '@/guest/pages/VenuePage';
export { VenueListPage } from '@/guest/pages/VenueListPage';
export { CartPage } from '@/guest/pages/CartPage';
export { ChatPage } from '@/guest/pages/ChatPage';
export { OrdersPage } from '@/guest/pages/OrdersPage';
export { RoomPage } from '@/guest/pages/RoomPage';
export { SearchPage } from '@/guest/pages/SearchPage';
export { OrderStatusPage } from '@/guest/pages/OrderStatusPage';
