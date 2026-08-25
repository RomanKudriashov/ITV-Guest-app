import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';

import { useAuth } from './AuthProvider';

/**
 * Калитка CMS.
 *
 * `fallback` — экран входа НА МЕСТЕ, без перехода. Нужен там, где адрес входа и
 * адрес панели совпали: на хосте отеля CMS живёт в `/admin`, отдельного
 * `/login` там нет (он постоянный редирект сюда же), и увод на него дал бы
 * петлю. Без `fallback` поведение прежнее — уводим на `/login`.
 */
export function RequireAuth({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { isAuthenticated, isBootstrapping } = useAuth();
  const location = useLocation();

  if (isBootstrapping) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'background.default',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    if (fallback) return <>{fallback}</>;
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
