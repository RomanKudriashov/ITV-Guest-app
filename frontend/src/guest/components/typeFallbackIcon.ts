import {
  IconRestaurant,
  IconServices,
  IconSlots,
  IconInfo,
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

export function fallbackIconFor(type: string | null | undefined): AppIconComponent {
  return ICON_BY_TYPE[behaviourFor(type).type];
}
