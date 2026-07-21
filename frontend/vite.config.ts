import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

import { DEFAULT_BRAND_TOKENS } from './src/theme/tokens';

/**
 * The PWA manifest is GENERATED from the brand tokens rather than checked in as
 * a static file: the project rule is that no color literal may live outside
 * `src/theme/tokens.ts`, and `theme_color` / `background_color` are colors.
 */
function webManifestPlugin(): Plugin {
  const colors = DEFAULT_BRAND_TOKENS.palette.light;
  const manifest = {
    name: 'ITV Guest',
    short_name: 'ITV Guest',
    description: 'In-room ordering and hotel services',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: colors.background,
    theme_color: colors.primary,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  const body = JSON.stringify(manifest, null, 2);

  return {
    name: 'itv-web-manifest',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/manifest.webmanifest') return next();
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(body);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: body });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_API_PROXY || 'http://localhost:8000';

  return {
    plugins: [react(), webManifestPlugin()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      // Docker bind-mounts on macOS/Windows don't propagate fs events reliably.
      watch: {
        usePolling: true,
        interval: 300,
      },
      // Keep HMR reachable when the dev server runs inside a container.
      // The container publishes 5173 on a different host port (5183 by default),
      // so the client port must follow the browser URL unless overridden.
      hmr: env.VITE_HMR_CLIENT_PORT
        ? { clientPort: Number(env.VITE_HMR_CLIENT_PORT) }
        : true,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/ws': {
          target: proxyTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
