import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';

import { OrderTimeline } from '@/guest/components/OrderTimeline';
import { OrderActions } from './OrderActions';
import { statusSlot } from '../statusColor';
import { formatClock, whenText, whereText } from '../orderText';
import { useTrackerLanguage } from '../hooks/useTrackerQueries';
import { useTrackerMoney } from '../hooks/useTrackerMoney';
import type { TrackerOrder } from '../api/types';

export interface OrderDetailSheetProps {
  order: TrackerOrder | null;
  open: boolean;
  busy: boolean;
  errorText?: string | null;
  /** The board is still loading and the deep-linked order is not in it yet. */
  loading?: boolean;
  onClose: () => void;
  onAccept: () => void;
  onStatus: (code: string) => void;
  onCancel: () => void;
}

/**
 * Full order card. A bottom sheet on the phone, a side panel on a monitor —
 * same component, because the content is identical and the cook is the same
 * person whichever device is at hand.
 */
export function OrderDetailSheet({
  order,
  open,
  busy,
  errorText,
  loading,
  onClose,
  onAccept,
  onStatus,
  onCancel,
}: OrderDetailSheetProps) {
  const { t } = useTranslation();
  const language = useTrackerLanguage();
  const { format } = useTrackerMoney();

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          maxHeight: '92vh',
          borderTopLeftRadius: (theme) => theme.shape.borderRadius * 1.6,
          borderTopRightRadius: (theme) => theme.shape.borderRadius * 1.6,
          bgcolor: 'background.paper',
        },
      }}
    >
      {busy ? <LinearProgress /> : null}
      <Box sx={{ p: 2, pb: 3 }} data-testid="tracker-order-detail">
        {!order ? (
          <Stack spacing={1} sx={{ py: 4 }} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              {loading ? t('tracker.detail.loading') : t('tracker.detail.notFound')}
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="h6" sx={{ flexGrow: 1 }}>
                {t('tracker.card.number', { number: order.number })}
              </Typography>
              <Chip
                size="small"
                label={order.status.title}
                color={statusSlot(order.status.color_token)}
              />
              <IconButton
                onClick={onClose}
                aria-label={t('tracker.detail.close')}
                data-testid="tracker-detail-close"
                sx={{ minWidth: 44, minHeight: 44 }}
              >
                <CloseIcon />
              </IconButton>
            </Stack>

            {errorText ? <Alert severity="error">{errorText}</Alert> : null}

            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Stack spacing={0.75}>
                <Row label={t('tracker.detail.where')} value={whereText(order, t)} />
                <Row label={t('tracker.detail.when')} value={whenText(order, t, language)} />
                <Row
                  label={t('tracker.detail.waiting')}
                  value={t('tracker.card.waiting', { minutes: order.waiting_minutes })}
                  emphasize={order.is_overdue}
                />
                <Row
                  label={t('tracker.detail.assignee')}
                  value={order.assignee?.name ?? t('tracker.detail.unassigned')}
                />
                {order.accepted_at ? (
                  <Row
                    label={t('tracker.detail.acceptedAt')}
                    value={formatClock(order.accepted_at, language)}
                  />
                ) : null}
                {order.comment ? (
                  <Row label={t('tracker.detail.comment')} value={order.comment} />
                ) : null}
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Stack divider={<Divider flexItem />} spacing={1.25}>
                {order.items.map((line) => (
                  <Stack key={line.id} direction="row" spacing={1.5} alignItems="flex-start">
                    <Typography variant="subtitle2" sx={{ minWidth: 28 }}>
                      {line.quantity}×
                    </Typography>
                    <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography variant="subtitle2">{line.title}</Typography>
                      {line.modifiers?.length ? (
                        <Typography variant="caption" color="text.secondary">
                          {line.modifiers.map((modifier) => modifier.title).join(' · ')}
                        </Typography>
                      ) : null}
                      {line.comment ? (
                        <Typography variant="caption" color="warning.main">
                          {line.comment}
                        </Typography>
                      ) : null}
                    </Stack>
                    <Typography variant="body2">
                      {format(line.line_total, order.currency)}
                    </Typography>
                  </Stack>
                ))}
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="subtitle1">{t('tracker.detail.total')}</Typography>
                  <Typography variant="subtitle1">
                    {format(order.total, order.currency)}
                  </Typography>
                </Stack>
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('tracker.detail.timeline')}
              </Typography>
              <OrderTimeline order={order} />
            </Paper>

            <OrderActions
              order={order}
              busy={busy}
              onAccept={onAccept}
              onStatus={onStatus}
              onCancel={onCancel}
            />
          </Stack>
        )}
      </Box>
    </Drawer>
  );
}

function Row({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        color={emphasize ? 'error.main' : 'text.primary'}
        sx={{ textAlign: 'end' }}
      >
        {value}
      </Typography>
    </Stack>
  );
}
