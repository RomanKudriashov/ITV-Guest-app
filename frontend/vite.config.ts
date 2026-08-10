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
      /*
        ИМЯ МАШИНЫ ВМЕСТО АДРЕСА. Стенд открывают и с ноутбука, и с телефона, а
        LAN-адрес ноутбука уплывает при каждой смене сети: домашний Wi-Fi,
        раздача с телефона, перезагрузка роутера — и ссылки на картинки ведут в
        никуда, потому что адрес зашит в MINIO_PUBLIC_ENDPOINT. mDNS-имя
        `<hostname>.local` переживает всё это: его раздаёт сама машина.

        Vite с 5.4.12 блокирует запросы с незнакомым заголовком Host (защита от
        DNS rebinding) и отвечает 403 — на имя `.local` в том числе. Точка в
        начале записи означает «домен и всё, что под ним», поэтому переименование
        машины список не ломает.

        Адреса и localhost Vite пропускает сам, отдельной записи им не нужно.
      */
      allowedHosts: env.VITE_ALLOWED_HOSTS
        ? env.VITE_ALLOWED_HOSTS.split(',').map((entry) => entry.trim())
        : ['.local'],
      // WHY NOT POLLING. Polling used to be the safe default for Docker
      // bind-mounts, and it is what made the dev server serve stale modules:
      // in polling mode chokidar notices a NEW file only when the directory's
      // mtime moves, and on this mount the directory mtime never moves — the
      // file shows up in `ls` while `stat` on the folder stays frozen. So any
      // file created after the server started was transformed once, on first
      // request, and every later edit to it was invisible until the container
      // was restarted. Files that existed at startup kept updating, which is
      // why it read as random flakiness rather than a rule.
      //
      // Native events do arrive through the mount (verified: both `add` and
      // `change` fire), so we use them. Polling stays available for mounts
      // where they genuinely don't — one env var, not a permanent tax.
      watch: env.VITE_WATCH_POLLING
        ? { usePolling: true, interval: 300 }
        : undefined,
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
