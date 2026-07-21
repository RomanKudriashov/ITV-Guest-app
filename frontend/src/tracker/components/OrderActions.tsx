import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import CheckIcon from '@mui/icons-material/Check';
import { useTranslation } from 'react-i18next';

import { statusSlot } from '../statusColor';
import type { TrackerOrder } from '../api/types';

export interface OrderActionsProps {
  order: TrackerOrder;
  /** True while any action of THIS order is in flight — buttons stay disabled. */
  busy: boolean;
  onAccept: () => void;
  onStatus: (code: string) => void;
  onCancel: () => void;
  size?: 'small' | 'medium';
}

/**
 * Buttons come from the server: `next_statuses` and `can_cancel` are computed
 * server-side, so what the cook can press always matches what the API accepts.
 * The client knows no transition rules and translates no status title.
 */
export function OrderActions({
  order,
  busy,
  onAccept,
  onStatus,
  onCancel,
  size = 'medium',
}: OrderActionsProps) {
  const { t } = useTranslation();
  const canAccept = !order.accepted_at && !order.status.is_terminal;

  if (!canAccept && !order.next_statuses.length && !order.can_cancel) return null;

  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {canAccept ? (
        <Button
          variant="contained"
          size={size}
          disabled={busy}
          startIcon={<CheckIcon />}
          onClick={onAccept}
          data-testid={`tracker-accept-${order.number}`}
          sx={{ minHeight: 44, flexGrow: 1 }}
        >
          {t('tracker.actions.accept')}
        </Button>
      ) : null}

      {/* The natural next step is the loud one; the rest stay quiet, so a cook
          in a hurry does not have to read four identical green buttons. */}
      {order.next_statuses.map((next, index) => (
        <Button
          key={next.code}
          variant={!canAccept && index === 0 ? 'contained' : 'outlined'}
          size={size}
          color={statusSlot(next.color_token)}
          disabled={busy}
          onClick={() => onStatus(next.code)}
          data-testid={`tracker-status-${order.number}-${next.code}`}
          sx={{ minHeight: 44, flexGrow: 1 }}
        >
          {next.title}
        </Button>
      ))}

      {order.can_cancel ? (
        <Button
          variant="text"
          size={size}
          color="error"
          disabled={busy}
          onClick={onCancel}
          data-testid={`tracker-cancel-${order.number}`}
          sx={{ minHeight: 44 }}
        >
          {t('tracker.actions.cancel')}
        </Button>
      ) : null}
    </Stack>
  );
}
