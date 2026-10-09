/**
 * КАКОЙ СТЕНД ПРОВЕРЯЕМ ПО УМОЛЧАНИЮ (партия 51).
 *
 * Главная база стенда — первая в `APP_DOMAINS` его `.env.prod`; с партии 50 это
 * naviroom. Без переменных смок идёт туда. Второй прогон — по другой базе:
 *
 *     E2E_STAND_BASE=app.147.45.245.172.sslip.io npm run smoke
 *
 * `E2E_STAND` / `E2E_STAND_HOTEL` по-прежнему задают адреса целиком (например,
 * локальный прогон: `http://localhost:5183`).
 */
export const MAIN_BASE = 'naviroom.navicentric.ru'
export const STAND_BASE = process.env.E2E_STAND_BASE ?? MAIN_BASE
export const HOTEL = process.env.E2E_HOTEL ?? 'crystal'
export const STAND = process.env.E2E_STAND ?? `https://${STAND_BASE}`
export const HOTEL_BASE = process.env.E2E_STAND_HOTEL ?? `https://${HOTEL}.${STAND_BASE}`
