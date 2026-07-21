import React from 'react';
import ReactDOM from 'react-dom/client';

import '@/i18n';
import { AppThemeProvider } from '@/theme';
import App from '@/App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found in index.html');
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <AppThemeProvider>
      <App />
    </AppThemeProvider>
  </React.StrictMode>,
);
