import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { useTrackerMoney } from '@/tracker/hooks/useTrackerMoney';
import { formatAge } from '@/tracker/orderAge';
import type { OrdersSummary } from './api';

/**
 * ЧЕТЫРЕ ЧИСЛА ПО ТЕКУЩЕЙ ВЫБОРКЕ — и они меняются вместе с фильтром.
 *
 * Именно «по выборке», а не за смену: над историей висела плитка «Сделано 28»
 * (столько закрыто за сегодня) при 986 записях в списке — два верных числа на
 * одном экране, и ни одно не про то, что видно.
 *
 * «Скорость» пустая, а не нулевая, когда закрытых заказов в выборке нет:
 * «никто ещё не закрыл» и «закрывают мгновенно» — разные новости.
 */
export function OrdersNumbers({ summary }: { summary: OrdersSummary }) {
  const { t, i18n } = useTranslation();
  const { format: money } = useTrackerMoney();
  const language = i18n.resolvedLanguage ?? 'ru';

  const tiles = [
    { key: 'orders', label: t('orders.numbers.count'), value: String(summary.orders) },
    { key: 'revenue', label: t('orders.numbers.revenue'), value: money(summary.revenue_minor) },
    { key: 'cancelled', label: t('orders.numbers.cancelled'), value: String(summary.cancelled) },
    {
      key: 'speed',
      label: t('orders.numbers.speed'),
      value:
        summary.median_minutes === null
          ? '—'
          : formatAge(summary.median_minutes, null, t, language),
    },
  ];

  return (
    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap data-testid="orders-numbers">
      {tiles.map((tile) => (
        <Card key={tile.key} variant="outlined" sx={{ minWidth: 150, flexGrow: 1 }}>
          <CardContent sx={{ py: 1.25 }}>
            <Typography variant="caption" color="text.secondary">
              {tile.label}
            </Typography>
            <Typography variant="h6" data-testid={`orders-number-${tile.key}`}>
              {tile.value}
            </Typography>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}
