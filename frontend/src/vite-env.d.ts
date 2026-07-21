/// <reference types="vite/client" />

declare module 'stylis-plugin-rtl' {
  import type { Middleware } from 'stylis';
  const rtlPlugin: Middleware;
  export default rtlPlugin;
}
