import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { OrderJournal } from '@/tracker/components/OrderJournal';
import { useTrackerMoney } from '@/tracker/hooks/useTrackerMoney';
import type { TrackerOrder } from '@/tracker/api/types';

/**
 * ПОЛНАЯ КАРТОЧКА ЗАКАЗА В РАЗБОРЕ: состав, деньги, комната, кто вёл, все
 * переходы со временем и — для отменённых — кто отменил и почему.
 *
 * Журнал переиспользован целиком (`OrderJournal` из трекера): второй его
 * экземпляр разошёлся бы с первым в том, что считать откатом и как показывать
 * «систему».
 */
export function OrderCardDetail({ order }: { order: TrackerOrder }) {
  const { t } = useTranslation();
  const { format: money } = useTrackerMoney();

  return (
    <Stack spacing={1.5} sx={{ mt: 1.5 }} data-testid={`orders-detail-${order.number}`}>
      <Divider />

      <Stack spacing={0.5}>
        {order.items.map((line) => (
          <Stack key={line.id} direction="row" spacing={1} justifyContent="space-between">
            <Typography variant="body2">
              {line.quantity}× {line.title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {money(line.line_total ?? 0)}
            </Typography>
          </Stack>
        ))}
      </Stack>

      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <Typography variant="body2">
          {t('orders.detail.total')}: <strong>{money(order.total ?? 0)}</strong>
        </Typography>
        {order.room ? (
          <Typography variant="body2" color="text.secondary">
            {t('orders.row.room', { room: order.room })}
          </Typography>
        ) : null}
        <Typography variant="body2" color="text.secondary">
          {t('orders.detail.assignee')}:{' '}
          {order.assignee?.name ?? t('orders.detail.nobody')}
        </Typography>
      </Stack>

      {order.cancel_reason_title ? (
        <Typography variant="body2" color="warning.main" data-testid="orders-detail-reason">
          {t('orders.detail.cancelled', { reason: order.cancel_reason_title })}
        </Typography>
      ) : null}

      <Stack spacing={0.5}>
        <Typography variant="subtitle2">{t('tracker.journal.title')}</Typography>
        <OrderJournal entries={order.journal} />
      </Stack>
    </Stack>
  );
}
