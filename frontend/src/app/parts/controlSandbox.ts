/**
 * ПЕСОЧНИЦА CONTROL — варианты на выбор (63-1: плитки номерного фонда). Только
 * в dev-сборке: маршрут `/admin/sandbox` заводится под `import.meta.env.DEV`,
 * и в боевой сборке этой части нет.
 */
export { SandboxApp } from '@/admin/sandbox/SandboxApp';
