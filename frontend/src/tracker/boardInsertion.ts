/**
 * КУДА ЛЯЖЕТ КАРТОЧКА, ЕСЛИ ОТПУСТИТЬ ЗДЕСЬ.
 *
 * Место считается по ПРЯМОУГОЛЬНИКАМ УЖЕ НАРИСОВАННЫХ КАРТОЧЕК, а не по их
 * данным. Причина простая: человек целится в то, что видит. Высота карточки
 * зависит от состава заказа, от комментария, от того, влез ли адрес в строку, —
 * и вычислить её из модели нельзя, а измерить можно.
 *
 * Несомая карточка из счёта исключается: она осталась в разметке (бледной, с
 * пунктирным контуром), и считать её соседкой самой себе значило бы сдвигать
 * ответ на единицу в половине случаев.
 */
export function insertionIndexAt(
  columnCode: string,
  draggedNumber: number | null,
  pointerY: number | null,
  root: Document | HTMLElement = document,
): number | null {
  if (pointerY === null) return null;
  const column = root.querySelector(`[data-testid="tracker-column-${columnCode}"]`);
  if (!column) return null;

  const cards = Array.from(column.querySelectorAll('[data-testid^="tracker-order-"]')).filter(
    (card) => card.getAttribute('data-testid') !== `tracker-order-${draggedNumber}`,
  );

  for (let index = 0; index < cards.length; index += 1) {
    const box = cards[index].getBoundingClientRect();
    // Середина карточки — граница решения: выше неё человек метит ПЕРЕД ней,
    // ниже — после. Граница по краю давала бы мёртвую зону в межкарточном
    // промежутке, где зазор не показывался бы вовсе.
    if (pointerY < box.top + box.height / 2) return index;
  }
  return cards.length;
}

/**
 * Соседи для запроса перестановки: между кем встала карточка.
 *
 * Список берётся БЕЗ самой несомой — сервер спросит «между этими двумя», и
 * назвать соседкой саму себя он справедливо откажется.
 */
export function neighboursAt<T extends { id: string }>(
  orders: T[],
  draggedId: string,
  index: number,
): { after: string | null; before: string | null } {
  const others = orders.filter((order) => order.id !== draggedId);
  return {
    after: others[index - 1]?.id ?? null,
    before: others[index]?.id ?? null,
  };
}
