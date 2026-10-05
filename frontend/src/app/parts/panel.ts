/**
 * ЧАСТЬ «ПАНЕЛЬ ОТЕЛЯ» — оболочка и разделы CMS. Вход — своя часть (`login.ts`).
 *
 * Грузится, только когда сотрудник пошёл в панель. Разделы пока одним файлом:
 * деление панели по разделам — следующий шаг п.65.
 */
export { AppShell } from '@/layouts/AppShell';
export { CategoryEditorPage } from '@/pages/category/CategoryEditorPage';
export { ItemEditorPage } from '@/pages/item/ItemEditorPage';
export { NotificationsPage } from '@/pages/notifications/NotificationsPage';
export { OrdersPage as CmsOrdersPage } from '@/cms/orders/OrdersPage';
export { RoomsPage } from '@/pages/hotel/RoomsPage';
export { StaffPage } from '@/pages/hotel/StaffPage';
export { BrandPage } from '@/cms/brand/BrandPage';
export { ServicesPage } from '@/cms/services/ServicesPage';
export { ServiceWorkspacePage } from '@/cms/services/ServiceWorkspacePage';
export { SettingsPage } from '@/cms/settings/SettingsPage';
export { DashboardPage } from '@/cms/dashboard/DashboardPage';
export { StyleguidePage } from '@/cms/styleguide/StyleguidePage';
export { AnalyticsPage } from '@/cms/analytics/AnalyticsPage';
export { ReviewsPage } from '@/cms/reviews/ReviewsPage';
export { MarketingPage } from '@/cms/marketing/MarketingPage';
export { QuickActionsPage } from '@/cms/quickActions/QuickActionsPage';
export { ModulePendingPage } from '@/pages/ModulePendingPage';
export { ProfilePage } from '@/pages/ProfilePage';
export { RoomControlPage } from '@/cms/roomControl/RoomControlPage';
export { DictionariesPage } from '@/cms/dictionaries/DictionariesPage';
