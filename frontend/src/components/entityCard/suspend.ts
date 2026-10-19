/**
 * КАРТОЧКИ НА ВРЕМЯ ПЕРЕТАСКИВАНИЯ — ГАСНУТ (партия 59а).
 *
 * Доска трекера тащит карточки заказов (dnd-kit), а имена внутри них — с
 * всплывающими карточками. Пока тащат, карточка закрывается и не открывается:
 * иначе она ехала бы за курсором поверх колонок. Доска зовёт
 * `suspendEntityCards(true)` в `onDragStart` и `false` в конце.
 */

type Listener = (suspended: boolean) => void;

let suspended = false;
const listeners = new Set<Listener>();

export function suspendEntityCards(next: boolean): void {
  if (suspended === next) return;
  suspended = next;
  listeners.forEach((listener) => listener(next));
}

export function isSuspended(): boolean {
  return suspended;
}

export function onSuspend(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
