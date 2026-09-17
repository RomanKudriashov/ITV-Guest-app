import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGuestActiveOrders, useGuestOrder } from '../hooks/useGuestQueries';
import { ReviewBlock } from './ReviewBlock';

/*
  Закрытую карточку помним на устройстве гостя: это его удобство, а не данные
  отеля. Хранится один номер — последнего закрытого: старые неоценённые
  следом не всплывают, сервер их и не предлагает.
*/
const DISMISSED_KEY = 'itv.guest.review.dismissed';

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(orderId: string): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, orderId);
  } catch {
    // Хранилище закрыто (приватное окно) — карточка просто закроется до перезагрузки.
  }
}

/**
 * Одна карточка «Оцените заказ» на стартовой — по последнему ЗАКРЫТОМУ заказу.
 * Живой заказ не предлагается: его оценка — оценка ожидания.
 */
export function HomeReviewCard() {
  const { t } = useTranslation();
  const { data } = useGuestActiveOrders();
  const candidate = data?.to_review ?? null;
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);
  const visible = candidate && candidate.id !== dismissed ? candidate : null;
  const { data: order, refetch } = useGuestOrder(visible?.id);

  /*
    КЭШ ЗАКАЗА МОЖЕТ ОТСТАВАТЬ ОТ СПИСКА. Гость оформил заказ — экран
    подтверждения положил его в кэш живым. Список уже говорит «закрыт, оцените»,
    а кэш ещё «готовится», и блок оценки прячется: оценивать живой нельзя.
    Сервер уже сказал, что заказ закрыт, — перечитываем.
  */
  const stale = Boolean(order && !order.status.is_terminal);
  useEffect(() => {
    if (stale) void refetch();
  }, [stale, refetch]);

  if (!visible || !order) return null;

  const what = visible.summary
    ? visible.extra_count
      ? t('guest.review.homeWhatMore', {
          summary: visible.summary,
          count: visible.extra_count,
        })
      : visible.summary
    : null;

  return (
    <ReviewBlock
      order={order}
      testId="guest-home-review"
      heading={
        what
          ? t('guest.review.homeTitle', { number: visible.number, what })
          : t('guest.review.homeTitleShort', { number: visible.number })
      }
      onClose={() => {
        writeDismissed(visible.id);
        setDismissed(visible.id);
      }}
    />
  );
}
