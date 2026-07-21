/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend target for the dev proxy (docker: http://backend:8000). */
  readonly VITE_API_PROXY?: string;
  /** Tenant sent as `X-Hotel-Subdomain` on every API call. */
  readonly VITE_HOTEL_SUBDOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'stylis-plugin-rtl' {
  import type { Middleware } from 'stylis';
  const rtlPlugin: Middleware;
  export default rtlPlugin;
}
