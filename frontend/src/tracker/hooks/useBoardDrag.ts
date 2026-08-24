import { useCallback, useMemo, useRef, useState } from 'react';

import type { TrackerColumn, TrackerOrder } from '../api/types';

/**
 * ПЕРЕТАСКИВАНИЕ КАРТОЧЕК МЕЖДУ КОЛОНКАМИ.
 *
 * Три правила, и каждое лечит свою болезнь живой доски.
 *
 * 1. ПОКА ПАЛЕЦ НА КАРТОЧКЕ — СНИМКИ КОПЯТСЯ. Снимок заменяет доску целиком,
 *    и во время перетаскивания это значит, что колонки перестраиваются под
 *    рукой. Придержкой заведует `useBoardLive`; здесь — только момент, когда
 *    её включать и выключать.
 *
 * 2. ОПТИМИСТИЧНЫЙ СДВИГ ЖИВЁТ ДО ОТВЕТА СЕРВЕРА, А НЕ ДО СЛЕДУЮЩЕГО СНИМКА.
 *    Наивная версия ставит карточку в целевую колонку и ждёт снимка. Но
 *    первый же снимок — например, о ЧУЖОМ заказе — придёт раньше нашего
 *    ответа и покажет карточку на старом месте: она прыгнет назад и через
 *    полсекунды снова вперёд. Поэтому наложение снимается по ответу REST,
 *    успешному или нет, и никакой снимок его не трогает.
 *
 * 3. НЕДОПУСТИМЫЕ ЦЕЛИ ВИДНЫ В МОМЕНТ ЗАХВАТА. Переходы на сервере идут
 *    только вперёд (`sort_order` строго больше текущего): блюдо нельзя
 *    разготовить. Разрешённые статусы приезжают с каждым заказом
 *    (`next_statuses`), поэтому запрет виден ДО броска, а не краснеет после.
 *    Красный отказ на действие, которое мы могли запретить заранее, — это
 *    наша ошибка, а не ошибка повара.
 */

export interface BoardDrag {
  /** Заказ, который сейчас несут. `null` — покоя. */
  draggingId: string | null;
  /** Коды колонок, куда этот заказ бросить МОЖНО. Пусто, когда не несут. */
  allowedTargets: Set<string>;
  /** Куда карточка уже переехала на экране, пока сервер не ответил. */
  overlay: Record<string, string>;
  onDragStart: (orderId: string) => void;
  onDragCancel: () => void;
  /** Бросок. Возвращает целевой статус, если он допустим, иначе `null`. */
  onDragEnd: (orderId: string, targetColumn: string | null) => string | null;
  /** Ответ сервера пришёл — наложение снимается независимо от исхода. */
  settle: (orderId: string) => void;
}

export function useBoardDrag(
  orders: TrackerOrder[],
  /** Придержка снимков живого контура на время жеста. */
  hold: (on: boolean) => void,
): BoardDrag {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Record<string, string>>({});
  // Заказы в ref: обработчики жеста живут дольше одного рендера, и замыкание
  // на устаревший список отдало бы вчерашний `next_statuses`.
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  const allowedTargets = useMemo(() => {
    if (!draggingId) return new Set<string>();
    const order = orders.find((candidate) => candidate.id === draggingId);
    return new Set((order?.next_statuses ?? []).map((status) => status.code));
  }, [draggingId, orders]);

  const onDragStart = useCallback(
    (orderId: string) => {
      hold(true);
      setDraggingId(orderId);
    },
    [hold],
  );

  const onDragCancel = useCallback(() => {
    setDraggingId(null);
    hold(false);
  }, [hold]);

  const onDragEnd = useCallback(
    (orderId: string, targetColumn: string | null): string | null => {
      setDraggingId(null);
      hold(false);

      if (!targetColumn) return null;
      const order = ordersRef.current.find((candidate) => candidate.id === orderId);
      if (!order) return null;
      // Бросок в ту же колонку — не перемещение, а промах. Молча ничего.
      if (order.status.code === targetColumn) return null;
      const allowed = (order.next_statuses ?? []).some(
        (status) => status.code === targetColumn,
      );
      // Сюда попасть не должны — недопустимая колонка не принимает бросок, —
      // но проверка стоит и здесь: клавиатурный жест и будущая правка UI не
      // обязаны знать про правило перехода.
      if (!allowed) return null;

      setOverlay((previous) => ({ ...previous, [orderId]: targetColumn }));
      return targetColumn;
    },
    [hold],
  );

  const settle = useCallback((orderId: string) => {
    setOverlay((previous) => {
      if (!(orderId in previous)) return previous;
      const next = { ...previous };
      delete next[orderId];
      return next;
    });
  }, []);

  return { draggingId, allowedTargets, overlay, onDragStart, onDragCancel, onDragEnd, settle };
}

/**
 * Колонки с учётом наложения: карточка показана там, куда её положили, ещё до
 * ответа сервера.
 *
 * Переклад делается НАД снимком, а не в нём: снимок — правда сервера, и
 * править его значило бы потерять единственный источник, с которым мы
 * сверяемся. Наложение живёт рядом и снимается по ответу.
 */
export function applyOverlay(
  columns: TrackerColumn[],
  overlay: Record<string, string>,
): TrackerColumn[] {
  if (!Object.keys(overlay).length) return columns;

  const moved = new Map<string, TrackerOrder[]>();
  const result = columns.map((column) => ({
    ...column,
    orders: column.orders.filter((order) => {
      const target = overlay[order.id];
      if (!target || target === column.code) return true;
      const bucket = moved.get(target) ?? [];
      bucket.push(order);
      moved.set(target, bucket);
      return false;
    }),
  }));

  if (!moved.size) return result;
  return result.map((column) =>
    moved.has(column.code)
      ? { ...column, orders: [...column.orders, ...(moved.get(column.code) as TrackerOrder[])] }
      : column,
  );
}
