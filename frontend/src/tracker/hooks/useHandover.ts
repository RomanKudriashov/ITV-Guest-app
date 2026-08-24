import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';

import type { TrackerOrder } from '../api/types';

/**
 * ЗАКАЗ УШЁЛ НЕ ПО МОЕМУ ДЕЙСТВИЮ — СКАЗАТЬ ОБ ЭТОМ.
 *
 * Доска живая: пока официант читает карточку, её берёт другой официант или
 * закрывает старший смены. Карточка исчезала МОЛЧА, и человек шёл искать её
 * глазами по колонкам, а потом обновлять страницу.
 *
 * СВОЁ ДЕЙСТВИЕ ОТЛИЧАЕТСЯ ОТ ЧУЖОГО ПО РЕЕСТРУ, А НЕ ПО СОВПАДЕНИЮ.
 *
 * Соблазн — считать чужим всё, что изменилось не сразу после нашего клика, или
 * сравнивать имя исполнителя со своим. Оба способа врут: первый на медленной
 * сети объявит чужим наше же действие, второй промолчит, когда тот же человек
 * работает со второго планшета. Поэтому мы ЗАПИСЫВАЕМ идентификаторы заказов,
 * которые тронули сами, и вычитаем их. Что осталось — точно не мы.
 *
 * Два разных события, и путать их нельзя:
 *   ВЗЯЛИ   — заказ на месте, но у него появился исполнитель. Самый частый и
 *             самый обидный случай: официант несёт то, что уже несут.
 *   ЗАКРЫЛИ — заказ исчез с активной доски совсем.
 */

export interface HandoverNotice {
  kind: 'taken' | 'gone';
  number: number;
  who: string | null;
}

export interface Handover {
  notice: HandoverNotice | null;
  /** Отметить заказ своим — до отправки запроса, а не после ответа. */
  mark: (orderId: string) => void;
  dismiss: () => void;
}

export function useHandover(orders: TrackerOrder[] | undefined): Handover {
  const [notice, setNotice] = useState<HandoverNotice | null>(null);
  /** Что мы тронули сами. Идентификатор живёт до первого объяснения. */
  const mineRef = useRef<Set<string>>(new Set());
  /** Прошлый состав доски: номер и исполнитель на момент прошлого снимка. */
  const seenRef = useRef<Map<string, { number: number; assignee: string | null }> | null>(null);

  useEffect(() => {
    if (!orders) return;
    const current = new Map(
      orders.map((order) => [
        order.id,
        { number: order.number, assignee: order.assignee?.name ?? null },
      ]),
    );
    const previous = seenRef.current;
    seenRef.current = current;
    // Первый снимок сравнивать не с чем: всё на нём «появилось», и объявлять
    // это чужими действиями значило бы завалить экран при каждом открытии.
    if (!previous) return;

    for (const [id, before] of previous) {
      if (mineRef.current.has(id)) {
        mineRef.current.delete(id);
        continue;
      }
      const after = current.get(id);
      if (!after) {
        setNotice({ kind: 'gone', number: before.number, who: before.assignee });
        return;
      }
      if (!before.assignee && after.assignee) {
        setNotice({ kind: 'taken', number: after.number, who: after.assignee });
        return;
      }
    }
  }, [orders]);

  return {
    notice,
    mark: (orderId: string) => {
      mineRef.current.add(orderId);
    },
    dismiss: () => setNotice(null),
  };
}

export function handoverText(notice: HandoverNotice, t: TFunction): string {
  if (notice.kind === 'taken') {
    return notice.who
      ? t('tracker.handover.takenBy', { number: notice.number, name: notice.who })
      : t('tracker.handover.taken', { number: notice.number });
  }
  return notice.who
    ? t('tracker.handover.closedBy', { number: notice.number, name: notice.who })
    : t('tracker.handover.closed', { number: notice.number });
}
