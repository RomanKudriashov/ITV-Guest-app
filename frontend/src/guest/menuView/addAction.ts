import { behaviourFor, type OfferingType } from '@/offerings/behaviour';
import type { MenuItem } from '../api/types';

/**
 * ЧТО ДЕЛАЕТ «+» У ПОЗИЦИИ (партия 57) — одно решение на оба вида меню.
 *
 *   `none`  — заказа нет вовсе: инфо-страница или позиция сейчас недоступна;
 *   `sheet` — открыть карточку позиции: у неё есть ЛЮБОЙ выбор — модификаторы
 *             (и необязательные тоже), поля заявки, слоты;
 *   `add`   — положить сразу: выбирать нечего.
 *
 * Раньше карточки открывали лист только при ОБЯЗАТЕЛЬНЫХ модификаторах, и
 * необязательная добавка к блюду оставалась невидимой: «+» клал голое блюдо,
 * и гость не узнавал, что можно было с сыром. Решение тек-лида — любой выбор
 * показывается до корзины, в обоих видах одинаково.
 */
export type AddMode = 'none' | 'sheet' | 'add';

export interface AddDecision {
  mode: AddMode;
  /** Почему лист — подпись кнопки в карточках: слот, форма или выбор. */
  reason: 'slot' | 'fields' | 'options' | null;
}

export function decideAdd(
  item: Pick<
    MenuItem,
    'type' | 'has_fields' | 'has_modifiers' | 'has_required_modifiers' | 'modifier_groups'
  >,
  fallbackType: OfferingType,
  opts: { available: boolean; bookAhead?: boolean },
): AddDecision {
  const behaviour = behaviourFor(item.type ?? fallbackType);
  if (behaviour.usesContent) return { mode: 'none', reason: null };
  // Слот, закрытый сейчас только по часам, бронируется на потом (партия 29).
  if (!opts.available && !(behaviour.usesSlots && opts.bookAhead)) return { mode: 'none', reason: null };
  if (behaviour.usesSlots) return { mode: 'sheet', reason: 'slot' };
  if (item.has_fields ?? behaviour.usesFields) return { mode: 'sheet', reason: 'fields' };
  const hasOptions =
    Boolean(item.has_modifiers) ||
    Boolean(item.has_required_modifiers) ||
    Boolean(item.modifier_groups?.some((group) => group.options?.length));
  if (hasOptions) return { mode: 'sheet', reason: 'options' };
  return { mode: 'add', reason: null };
}
