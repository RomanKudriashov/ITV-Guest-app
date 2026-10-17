import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * ЮНИТ-ТЕСТЫ ЧИСТЫХ ФУНКЦИЙ (партия 57): раскладка мозаики, логика «+»,
 * выбор вида меню. Свой конфиг, а не vite.config.ts: плагины сборки (манифест,
 * сторожа бандла) юнит-тестам не нужны и только замедляют.
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
