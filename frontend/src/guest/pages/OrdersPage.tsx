import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/EmptyState';
import { errorMessage } from '../errors';
import { useGuestOrders } from '../hooks/useGuestQueries';
import { useOrderLive } from '../hooks/useOrderLive';
import { useMoney } from '../hooks/useMoney';
import type { GuestOrder } from '../api/types';

export function OrdersPage() {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useGuestOrders();

  // Keep the most recent active order live even from the list.
  const primaryActiveId = data?.active?.[0]?.id;
  useOrderLive(primaryActiveId, Boolean(primaryActiveId));

  if (isLoading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress aria-label={t('guest.common.loading')} />
      </Stack>
    );
  }

  if (error) {
    return (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void refetch()}>
              {t('guest.common.retry')}
            </Button>
          }
        >
          {errorMessage(error, t)}
        </Alert>
      </Container>
    );
  }

  const active = data?.active ?? [];
  const past = data?.past ?? [];

  if (!active.length && !past.length) {
    return (
      <Box data-testid="guest-orders-list">
        <EmptyState
          title={t('guest.orders.emptyTitle')}
          description={t('guest.orders.emptyHint')}
          testId="guest-orders-empty"
        />
      </Box>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: 2 }} data-testid="guest-orders-list">
      <Stack spacing={3}>
        {active.length ? (
          <Section title={t('guest.orders.active')} orders={active} />
        ) : null}
        {past.length ? <Section title={t('guest.orders.past')} orders={past} /> : null}
      </Stack>
    </Container>
  );
}

function Section({ title, orders }: { title: string; orders: GuestOrder[] }) {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1" component="h2">
        {title}
      </Typography>
      <Stack spacing={1}>
        {orders.map((order) => (
          <OrderRow key={order.id} order={order} />
        ))}
      </Stack>
    </Stack>
  );
}

function OrderRow({ order }: { order: GuestOrder }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { format } = useMoney();

  const created = (() => {
    try {
      return new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(order.created_at));
    } catch {
      return order.created_at;
    }
  })();

  return (
    <Paper variant="outlined">
      <ButtonBase
        onClick={() => navigate(`/orders/${order.id}`)}
        data-testid={`guest-order-row-${order.number}`}
        sx={{
          width: '100%',
          p: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          textAlign: 'start',
          minHeight: 64,
        }}
      >
        <Stack sx={{ flexGrow: 1, minWidth: 0 }} spacing={0.5}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2">
              {t('guest.order.number', { number: order.number })}
            </Typography>
            <Chip
              size="small"
              label={order.status.title}
              color={order.status.is_cancelled ? 'default' : 'primary'}
              variant={order.status.is_terminal ? 'outlined' : 'filled'}
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {created} · {order.items.length ? order.items[0].title : ''}
            {order.items.length > 1 ? ` +${order.items.length - 1}` : ''}
          </Typography>
        </Stack>
        <Typography variant="body2">{format(order.total)}</Typography>
        <ChevronRightIcon fontSize="small" color="disabled" />
      </ButtonBase>
    </Paper>
  );
}
