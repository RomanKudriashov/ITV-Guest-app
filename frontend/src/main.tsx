import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@/i18n';
import { AppThemeProvider } from '@/theme';
import { AuthProvider } from '@/auth';
import { ToastProvider } from '@/components/ToastProvider';
import { router } from '@/app/router';
import { attachWebManifest } from '@/app/manifestLink';
import { retryTransient } from '@/api/retry';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Только сбой сети и 5xx: 4xx — ответ, повтором не лечится (api/retry.ts).
      retry: retryTransient,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

attachWebManifest();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found in index.html');
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </AppThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
