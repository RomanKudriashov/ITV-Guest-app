import {
  IconBath,
  IconRestaurant,
  IconServices,
  IconSlots,
  IconInfo,
  IconMakeUpRoom,
  type AppIconComponent,
} from '@/icons';
import { behaviourFor } from '@/offerings/behaviour';

/**
 * The monochrome icon drawn on an item's DESIGNED image fallback, chosen per
 * offering type. Resolved through the behaviour registry (never a `type ===`
 * chain), so it stays correct as types are added — an unknown type falls back to
 * the product icon, exactly like `behaviourFor`.
 */
const ICON_BY_TYPE: Record<string, AppIconComponent> = {
  product: IconRestaurant,
  service_request: IconServices,
  slot: IconSlots,
  info: IconInfo,
};

/**
 * ЗАГЛУШКА ПО ТИПУ ЗАВЕДЕНИЯ (партия 29). Вид предложения у товара всегда
 * `product`, и подушка хозслужбы или масло спа без фото получали «вилку и
 * нож». Заведение говорит о вещи больше: спа — ванна, хозслужба — уборка,
 * еда и напитки — приборы, прочие услуги — общий знак. Тип заведения
 * неизвестен (старый сервер, позиция без заведения) — по виду предложения.
 */
const ICON_BY_SERVICE_TYPE: Record<string, AppIconComponent> = {
  restaurant: IconRestaurant,
  bar: IconRestaurant,
  room_service: IconRestaurant,
  minibar: IconRestaurant,
  spa: IconBath,
  pool: IconBath,
  housekeeping: IconMakeUpRoom,
  concierge: IconServices,
  transfer: IconServices,
  excursions: IconServices,
  custom: IconServices,
  info: IconInfo,
};

export function fallbackIconFor(
  type: string | null | undefined,
  serviceType?: string | null,
): AppIconComponent {
  return (serviceType && ICON_BY_SERVICE_TYPE[serviceType]) || ICON_BY_TYPE[behaviourFor(type).type];
}
