import { Navigate, createBrowserRouter } from 'react-router-dom';

import { RequireAuth } from '@/auth';
import { AppShell } from '@/layouts/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { CategoryEditorPage } from '@/pages/category/CategoryEditorPage';
import { ItemEditorPage } from '@/pages/item/ItemEditorPage';
import { NotificationsPage } from '@/pages/notifications/NotificationsPage';
import { RoomsPage } from '@/pages/hotel/RoomsPage';
import { StaffPage } from '@/pages/hotel/StaffPage';
import { BrandPage } from '@/cms/brand/BrandPage';
import { ServicesPage } from '@/cms/services/ServicesPage';
import { ServiceWorkspacePage } from '@/cms/services/ServiceWorkspacePage';
import { SettingsPage } from '@/cms/settings/SettingsPage';
import { DashboardPage } from '@/cms/dashboard/DashboardPage';
import { StyleguidePage } from '@/cms/styleguide/StyleguidePage';
import { AnalyticsPage } from '@/cms/analytics/AnalyticsPage';
import { BadgesPage } from '@/cms/badges/BadgesPage';
import { QuickActionsPage } from '@/cms/quickActions/QuickActionsPage';
import { DictionariesPage } from '@/cms/dictionaries/DictionariesPage';
import { PlatformConsole } from '@/platform/PlatformConsole';
import App from '@/App';

import { TrackerPage } from '@/tracker/pages/TrackerPage';

import { GuestRoot } from '@/guest/GuestRoot';
import { GuestLayout } from '@/guest/layout/GuestLayout';
import { EntryPage } from '@/guest/pages/EntryPage';
import { HomePage } from '@/guest/pages/HomePage';
import { CatalogPage } from '@/guest/pages/CatalogPage';
import { VenuePage } from '@/guest/pages/VenuePage';
import { VenueListPage } from '@/guest/pages/VenueListPage';
import { CartPage } from '@/guest/pages/CartPage';
import { ChatPage } from '@/guest/pages/ChatPage';
import { OrdersPage } from '@/guest/pages/OrdersPage';
import { OrderStatusPage } from '@/guest/pages/OrderStatusPage';

/**
 * Data router — required for `useBlocker` (the unsaved-changes guard in the CMS).
 *
 * Layout of the app:
 *  - `/`         guest storefront (the product);
 *  - `/cms/*` + `/login` staff CMS, unchanged;
 *  - `/tracker`  staff order board — same JWT as the CMS, its own shell
 *                (a cook holds a phone, not a desktop sidebar).
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/dev/theme', element: <App /> },
  // Платформенная консоль на базовом домене. Своя область auth (scope: platform),
  // не пересекается с тенантной CMS.
  { path: '/platform', element: <PlatformConsole /> },
  {
    path: '/cms',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/cms/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },

      // Структура отеля: сервисы верхним уровнем, меню — внутри сервиса.
      { path: 'services', element: <ServicesPage /> },
      { path: 'services/:id', element: <ServiceWorkspacePage /> },
      { path: 'rooms', element: <RoomsPage /> },
      { path: 'staff', element: <StaffPage /> },

      // Редакторы позиции и категории — общие, вызываются из меню сервиса.
      { path: 'menu', element: <Navigate to="/cms/services" replace /> },
      { path: 'menu/categories/new', element: <CategoryEditorPage /> },
      { path: 'menu/categories/:id', element: <CategoryEditorPage /> },
      { path: 'menu/items/new', element: <ItemEditorPage /> },
      { path: 'menu/items/:id', element: <ItemEditorPage /> },

      // Оформление: бренд и витрина — один раздел.
      { path: 'brand', element: <BrandPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },

      // Настройки: сюда растворилась «Коммерция» и переехал справочник локаций.
      { path: 'settings', element: <SettingsPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'dictionaries', element: <DictionariesPage /> },

      // Модульные разделы: пункт в навигации появляется только с модулем,
      // но маршрут существует всегда — иначе прямая ссылка ломалась бы молча.
      { path: 'marketing', element: <BadgesPage /> },

      // Служебное: витрина отдельным адресом больше не нужна (слита с брендом),
      // старые ссылки уводим туда же, а не в 404.
      { path: 'showcase', element: <Navigate to="/cms/brand" replace /> },
      { path: 'commerce', element: <Navigate to="/cms/settings" replace /> },
      { path: 'locations', element: <Navigate to="/cms/settings" replace /> },
      { path: 'departments', element: <Navigate to="/cms/services" replace /> },
      { path: 'badges', element: <Navigate to="/cms/marketing" replace /> },
      { path: 'quick-actions', element: <QuickActionsPage /> },
      { path: 'styleguide', element: <StyleguidePage /> },
    ],
  },
  {
    path: '/tracker',
    element: (
      <RequireAuth>
        <TrackerPage />
      </RequireAuth>
    ),
  },
  {
    // Deep link to one order: the board stays mounted underneath and opens the
    // detail sheet, so the URL is shareable without a second data source.
    path: '/tracker/order/:id',
    element: (
      <RequireAuth>
        <TrackerPage />
      </RequireAuth>
    ),
  },
  {
    path: '/',
    element: <GuestRoot />,
    children: [
      { index: true, element: <EntryPage /> },
      // QR deep link — creates the session for the scanned room right away.
      { path: 'r/:roomNumber', element: <EntryPage /> },
      {
        element: <GuestLayout />,
        children: [
          { path: 'home', element: <HomePage /> },
          // Every catalog is the same screen with a different offering type;
          // there is deliberately no separate page component per type.
          // Плоского каталога отеля больше нет: меню живёт внутри заведения.
          // Старую ссылку уводим на главную, а не в 404 — она могла остаться
          // в закладке или в переписке.
          { path: 'menu', element: <Navigate to="/home" replace /> },
          { path: 'services', element: <CatalogPage type="service_request" /> },
          { path: 'info', element: <CatalogPage type="info" /> },
          { path: 'slots', element: <CatalogPage type="slot" /> },
          // Showcase levels 2 and 3: a group's venue list, and a venue's own catalog.
          { path: 'category/:group', element: <VenueListPage /> },
          { path: 'venue/:code', element: <VenuePage /> },
          { path: 'cart', element: <CartPage /> },
          { path: 'chat', element: <ChatPage /> },
          { path: 'orders', element: <OrdersPage /> },
          { path: 'orders/:id', element: <OrderStatusPage /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
