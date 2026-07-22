import { Navigate, createBrowserRouter } from 'react-router-dom';

import { RequireAuth } from '@/auth';
import { AppShell } from '@/layouts/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { MenuPage } from '@/pages/menu/MenuPage';
import { CategoryEditorPage } from '@/pages/category/CategoryEditorPage';
import { ItemEditorPage } from '@/pages/item/ItemEditorPage';
import { NotificationsPage } from '@/pages/notifications/NotificationsPage';
import { RoomsPage } from '@/pages/hotel/RoomsPage';
import { LocationsPage } from '@/pages/hotel/LocationsPage';
import { DepartmentsPage } from '@/pages/hotel/DepartmentsPage';
import { StaffPage } from '@/pages/hotel/StaffPage';
import { BrandPage } from '@/cms/brand/BrandPage';
import { AnalyticsPage } from '@/cms/analytics/AnalyticsPage';
import App from '@/App';

import { TrackerPage } from '@/tracker/pages/TrackerPage';

import { GuestRoot } from '@/guest/GuestRoot';
import { GuestLayout } from '@/guest/layout/GuestLayout';
import { EntryPage } from '@/guest/pages/EntryPage';
import { HomePage } from '@/guest/pages/HomePage';
import { CatalogPage } from '@/guest/pages/CatalogPage';
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
  {
    path: '/cms',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/cms/menu" replace /> },
      { path: 'menu', element: <MenuPage /> },
      { path: 'menu/categories/new', element: <CategoryEditorPage /> },
      { path: 'menu/categories/:id', element: <CategoryEditorPage /> },
      { path: 'menu/items/new', element: <ItemEditorPage /> },
      { path: 'menu/items/:id', element: <ItemEditorPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'rooms', element: <RoomsPage /> },
      { path: 'locations', element: <LocationsPage /> },
      { path: 'departments', element: <DepartmentsPage /> },
      { path: 'staff', element: <StaffPage /> },
      { path: 'brand', element: <BrandPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
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
          { path: 'menu', element: <CatalogPage type="product" /> },
          { path: 'services', element: <CatalogPage type="service_request" /> },
          { path: 'info', element: <CatalogPage type="info" /> },
          { path: 'slots', element: <CatalogPage type="slot" /> },
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
