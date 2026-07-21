import { Navigate, createBrowserRouter } from 'react-router-dom';

import { RequireAuth } from '@/auth';
import { AppShell } from '@/layouts/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { MenuPage } from '@/pages/menu/MenuPage';
import { CategoryEditorPage } from '@/pages/category/CategoryEditorPage';
import { ItemEditorPage } from '@/pages/item/ItemEditorPage';
import App from '@/App';

/**
 * Data router — required for `useBlocker` (the unsaved-changes guard).
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/dev/theme', element: <App /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/cms/menu" replace /> },
      { path: 'cms', element: <Navigate to="/cms/menu" replace /> },
      { path: 'cms/menu', element: <MenuPage /> },
      { path: 'cms/menu/categories/new', element: <CategoryEditorPage /> },
      { path: 'cms/menu/categories/:id', element: <CategoryEditorPage /> },
      { path: 'cms/menu/items/new', element: <ItemEditorPage /> },
      { path: 'cms/menu/items/:id', element: <ItemEditorPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/cms/menu" replace /> },
]);
