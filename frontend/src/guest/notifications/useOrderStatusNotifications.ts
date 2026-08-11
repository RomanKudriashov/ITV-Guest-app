import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { GuestOrder } from '../api/types';
import { notifyOrderStatus } from './orderNotifications';

/**
 * Показывать уведомление на КАЖДОЙ смене статуса заказа.
 *
 * Следит за снимком, который приходит по сокету и ложится в кэш запроса, —
 * своего источника не заводит. Первый увиденный статус не уведомляет: гость
 * только что открыл экран и этот статус видит сам.
 */
export function useOrderStatusNotifications(order: GuestOrder | undefined): void {
  const { t } = useTranslation();
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (!order) return;
    const code = order.status?.code ?? '';
    if (!code) return;

    if (seen.current === null) {
      seen.current = code;
      return;
    }
    if (seen.current === code) return;
    seen.current = code;

    notifyOrderStatus({
      orderNumber: order.number,
      statusTitle: order.status?.title ?? '',
      title: t('guest.notifications.orderTitle', { number: order.number }),
    });
  }, [order, t]);
}
