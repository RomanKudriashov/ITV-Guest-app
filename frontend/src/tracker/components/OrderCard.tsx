import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import { useTranslation } from 'react-i18next';

import { OrderFieldValues } from '@/guest/components/OrderFieldValues';
import { OrderSlot } from '@/guest/components/OrderSlot';
import { OrderActions } from './OrderActions';
import { statusSlot } from '../statusColor';
import { itemsSummary, totalText, whenText, whereText } from '../orderText';
import { useTrackerLanguage } from '../hooks/useTrackerQueries';
import { useTrackerMoney } from '../hooks/useTrackerMoney';
import type { TrackerOrder } from '../api/types';

export interface OrderCardProps {
  order: TrackerOrder;
  busy: boolean;
  /** Just arrived / just changed — a calm ring, no animation circus. */
  highlighted?: boolean;
  errorText?: string | null;
  onOpen: () => void;
  onAccept: () => void;
  onStatus: (code: string) => void;
  onCancel: () => void;
}

export function OrderCard({
  order,
  busy,
  highlighted,
  errorText,
  onOpen,
  onAccept,
  onStatus,
  onCancel,
}: OrderCardProps) {
  const { t } = useTranslation();
  const language = useTrackerLanguage();
  const { format } = useTrackerMoney();
  const colorSlot = statusSlot(order.status.color_token);
  const fieldValues = order.field_values ?? [];
  const booking = order.slot ?? null;

  return (
    <Card
      variant="outlined"
      data-testid={`tracker-order-${order.number}`}
      sx={{
        borderColor: highlighted ? `${colorSlot}.main` : 'divider',
        borderWidth: highlighted ? 2 : 1,
        overflow: 'hidden',
      }}
    >
      {busy ? <LinearProgress /> : null}

      <CardActionArea onClick={onOpen} sx={{ p: 1.5, pb: 1 }}>
        <Stack spacing={1}>
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {t('tracker.card.number', { number: order.number })}
            </Typography>
            <Chip size="small" label={order.status.title} color={colorSlot} variant="outlined" />
            <Box sx={{ flexGrow: 1 }} />
            <Chip
              size="small"
              icon={<AccessTimeIcon sx={{ fontSize: 16 }} />}
              color={order.is_overdue ? 'error' : 'default'}
              variant={order.is_overdue ? 'filled' : 'outlined'}
              label={t('tracker.card.waiting', { minutes: order.waiting_minutes })}
              data-testid={`tracker-waiting-${order.number}`}
            />
          </Stack>

          <Stack direction="row" spacing={0.75} alignItems="flex-start">
            <PlaceOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary', mt: '2px' }} />
            <Typography variant="body2" sx={{ minWidth: 0 }}>
              {whereText(order, t)}
            </Typography>
          </Stack>

          <Typography variant="caption" color="text.secondary">
            {whenText(order, t, language)}
          </Typography>

          {/*
            The ONLY difference a type makes on this board: the body of the
            card. Food shows its lines, a request shows the answers to its form,
            a booking shows the reserved slot. The choice is by the block that is
            present, never by the type string; columns, actions, statuses and the
            socket know nothing about it.
          */}
          {booking ? (
            <OrderSlot
              slot={booking}
              language={language}
              guestLabel={whereText(order, t)}
              testId="tracker-order-slot"
              dense
            />
          ) : fieldValues.length ? (
            <OrderFieldValues values={fieldValues} testId="tracker-order-fields" dense />
          ) : (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {itemsSummary(order)}
            </Typography>
          )}

          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="subtitle2">{totalText(order, format)}</Typography>
            <Box sx={{ flexGrow: 1 }} />
            {order.assignee ? (
              <Stack direction="row" spacing={0.5} alignItems="center">
                <PersonOutlineIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                <Typography variant="caption" color="text.secondary">
                  {order.assignee.name}
                </Typography>
              </Stack>
            ) : null}
          </Stack>
        </Stack>
      </CardActionArea>

      {errorText ? (
        <Box sx={{ px: 1.5, pb: 1 }}>
          <Alert severity="error" data-testid={`tracker-error-${order.number}`}>
            {errorText}
          </Alert>
        </Box>
      ) : null}

      <Divider />
      <Box sx={{ p: 1.5 }}>
        <OrderActions
          order={order}
          busy={busy}
          onAccept={onAccept}
          onStatus={onStatus}
          onCancel={onCancel}
        />
      </Box>
    </Card>
  );
}
