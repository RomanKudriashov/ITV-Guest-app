import { Navigate, createBrowserRouter } from 'react-router-dom';

import { RequireAuth } from '@/auth';
import { AppShell } from '@/layouts/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { MenuPage } from '@/pages/menu/MenuPage';
import { CategoryEditorPage } from '@/pages/category/CategoryEditorPage';
import { ItemEditorPage } from '@/pages/item/ItemEditorPage';
import App from '@/App';

import { TrackerPage } from '@/tracker/pages/TrackerPage';

import { GuestRoot } from '@/guest/GuestRoot';
import { GuestLayout } from '@/guest/layout/GuestLayout';
import { EntryPage } from '@/guest/pages/EntryPage';
import { HomePage } from '@/guest/pages/HomePage';
import { CatalogPage } from '@/guest/pages/CatalogPage';
import { CartPage } from '@/guest/pages/CartPage';
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
          // Both catalogs are the same screen with a different offering type;
          // there is deliberately no separate "services" page component.
          { path: 'menu', element: <CatalogPage type="product" /> },
          { path: 'services', element: <CatalogPage type="service_request" /> },
          { path: 'cart', element: <CartPage /> },
          { path: 'orders', element: <OrdersPage /> },
          { path: 'orders/:id', element: <OrderStatusPage /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
