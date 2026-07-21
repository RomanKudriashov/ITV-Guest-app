import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ItemThumb } from '../components/ItemMeta';
import { OrderFieldValues } from '../components/OrderFieldValues';
import { OrderTimeline } from '../components/OrderTimeline';
import { cancelOrder } from '../api/guest';
import { guestKeys } from '../api/queryKeys';
import { errorMessage } from '../errors';
import { useGuestLanguage, useGuestOrder } from '../hooks/useGuestQueries';
import { useOrderLive } from '../hooks/useOrderLive';
import { useMoney } from '../hooks/useMoney';
import type { GuestOrder } from '../api/types';

export function OrderStatusPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { formatOptional } = useMoney();
  const language = useGuestLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const justPlaced = searchParams.get('placed') === '1';

  // While the socket is down we fall back to polling, so the status still moves.
  const [pollMs, setPollMs] = useState<number | undefined>(undefined);
  const { data: order, isLoading, error, refetch } = useGuestOrder(id, pollMs);
  // Live status: snapshots land straight in the query cache (see useOrderLive).
  const live = useOrderLive(id, Boolean(order) && !order?.status.is_terminal);

  useEffect(() => {
    const stale = live !== 'online' && Boolean(order) && !order?.status.is_terminal;
    setPollMs(stale ? 15_000 : undefined);
  }, [live, order]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelError, setCancelError] = useState<unknown>(null);

  const cancelMutation = useMutation<GuestOrder, unknown, void>({
    mutationFn: () => cancelOrder(id as string, undefined, language),
    onSuccess: (updated) => {
      setCancelError(null);
      queryClient.setQueryData(guestKeys.order(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: ['guest', 'orders'] });
    },
    onError: (caught) => setCancelError(caught),
  });

  if (isLoading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress aria-label={t('guest.common.loading')} />
      </Stack>
    );
  }

  if (error || !order) {
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

  const fieldValues = order.field_values ?? [];

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

  const whenText =
    order.requested_time
      ? t('guest.order.byTime', {
          time: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en', {
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(order.requested_time)),
        })
      : t('guest.cart.asap');

  return (
    <Container maxWidth="sm" sx={{ py: 2 }} data-testid="guest-order-status">
      <Stack spacing={2.5}>
        {justPlaced ? (
          <Paper
            variant="outlined"
            sx={{ p: 2, borderColor: 'success.main' }}
            data-testid="guest-confirmation"
          >
            <Stack spacing={1.5} alignItems="flex-start">
              <Stack direction="row" spacing={1} alignItems="center">
                <CheckCircleOutlineIcon color="success" />
                <Typography variant="h6">{t('guest.confirmation.title')}</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {t('guest.confirmation.subtitle')}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
                <Button
                  variant="contained"
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete('placed');
                    setSearchParams(next, { replace: true });
                  }}
                  data-testid="guest-track-order"
                  sx={{ minHeight: 44, flexGrow: 1 }}
                >
                  {t('guest.confirmation.track')}
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => navigate('/menu')}
                  sx={{ minHeight: 44, flexGrow: 1 }}
                >
                  {t('guest.confirmation.toMenu')}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        ) : null}

        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
          <Typography variant="h6" component="h1" data-testid="guest-order-number">
            {t('guest.order.number', { number: order.number })}
          </Typography>
          <Chip size="small" label={order.status.title} color="primary" />
          {live === 'offline' && !order.status.is_terminal ? (
            <Chip
              size="small"
              variant="outlined"
              icon={<CloudOffIcon sx={{ fontSize: 16 }} />}
              label={t('guest.order.offline')}
              data-testid="guest-order-offline"
            />
          ) : null}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {created}
        </Typography>

        {order.eta_minutes ? (
          <Alert severity="info" icon={false} data-testid="guest-order-eta">
            {t('guest.order.eta', { minutes: order.eta_minutes })}
          </Alert>
        ) : null}

        <Paper variant="outlined" sx={{ p: 2 }}>
          <OrderTimeline order={order} />
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Row label={t('guest.order.where')} value={locationText(order, t)} />
            <Row label={t('guest.order.when')} value={whenText} />
            {order.comment ? (
              <Row label={t('guest.cart.comment')} value={order.comment} />
            ) : null}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack divider={<Divider flexItem />} spacing={1.5}>
            {/* Body of the order: answers for a request, lines for food. */}
            {fieldValues.length ? (
              <OrderFieldValues values={fieldValues} testId="guest-order-fields" />
            ) : null}
            {order.items.map((line) => (
              <Stack key={line.id} direction="row" spacing={1.5} alignItems="flex-start">
                <ItemThumb src={line.image_url} alt={line.title} size={48} />
                <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2">
                    {line.title} · {line.quantity}
                  </Typography>
                  {line.modifiers?.length ? (
                    <Typography variant="caption" color="text.secondary">
                      {line.modifiers.map((modifier) => modifier.title).join(' · ')}
                    </Typography>
                  ) : null}
                  {line.comment ? (
                    <Typography variant="caption" color="text.secondary">
                      {line.comment}
                    </Typography>
                  ) : null}
                </Stack>
                {formatOptional(line.line_total) ? (
                  <Typography variant="body2">{formatOptional(line.line_total)}</Typography>
                ) : null}
              </Stack>
            ))}
            {/* An unpriced order has no total — a dash, never "0 ₽". */}
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="subtitle1">{t('guest.cart.total')}</Typography>
              <Typography variant="subtitle1" data-testid="guest-order-total">
                {formatOptional(order.total) ?? t('guest.order.noPrice')}
              </Typography>
            </Stack>
          </Stack>
        </Paper>

        {cancelError ? (
          <Alert severity="error">{errorMessage(cancelError, t)}</Alert>
        ) : null}

        {order.status.allows_guest_cancel ? (
          <Button
            variant="outlined"
            color="error"
            disabled={cancelMutation.isPending}
            onClick={() => setConfirmOpen(true)}
            data-testid="guest-cancel-order"
            sx={{ minHeight: 48 }}
          >
            {t('guest.order.cancel')}
          </Button>
        ) : null}

        <Button variant="text" onClick={() => navigate('/orders')} sx={{ minHeight: 44 }}>
          {t('guest.order.allOrders')}
        </Button>

        <Box sx={{ height: 8 }} />
      </Stack>

      <ConfirmDialog
        open={confirmOpen}
        title={t('guest.order.cancelConfirmTitle')}
        description={t('guest.order.cancelConfirmBody')}
        confirmLabel={t('guest.order.cancel')}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          cancelMutation.mutate();
        }}
      />
    </Container>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'end' }}>
        {value}
      </Typography>
    </Stack>
  );
}

function locationText(order: GuestOrder, t: TFunction): string {
  const parts: string[] = [];
  if (order.location?.title) parts.push(order.location.title);
  if (order.location?.refinement) parts.push(order.location.refinement);
  if (order.room) parts.push(t('guest.common.roomShort', { room: order.room }));
  return parts.join(' · ') || '—';
}
