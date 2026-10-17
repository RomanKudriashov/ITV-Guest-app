import type { TFunction } from 'i18next';

import type { MenuItem } from '../api/types';
import { openingLabel } from '../nextOpening';

/**
 * ПРИЧИНА НЕДОСТУПНОСТИ СВОИМИ СЛОВАМИ — одна на карточки и мозаику (партия 57).
 *
 * «Доступно с 03:00» у блюда в закрытом ресторане верно по факту и неверно по
 * смыслу: закрыто ЗАВЕДЕНИЕ, а не блюдо. Причину присылает сервер
 * (`unavailable_reason`).
 */
export function unavailableNote(item: MenuItem, available: boolean, t: TFunction): string | null {
  if (available) return null;
  return (
    openingLabel(item, t) ??
    (item.unavailable_reason === 'venue_closed'
      ? t('guest.menu.venueClosed')
      : item.unavailable_reason === 'out_of_stock'
        ? t('guest.menu.outOfStock')
        : t('guest.menu.unavailable'))
  );
}
