import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { useTranslation } from 'react-i18next';

import { useDraftState } from '@/state/useDraftState';

export interface CancelDialogProps {
  open: boolean;
  orderNumber: number | null;
  orderId: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * The reason is unfinished user input, so it lives in `useDraftState` keyed by
 * the order id: a background refetch of the board can never wipe half-typed
 * text, and opening another order re-seeds the field.
 */
export function CancelDialog({
  open,
  orderNumber,
  orderId,
  busy,
  onClose,
  onConfirm,
}: CancelDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useDraftState<string>(() => '', orderId ?? 'none');

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('tracker.cancel.title', { number: orderNumber ?? '' })}</DialogTitle>
      <DialogContent>
        <DialogContentText variant="body2" sx={{ mb: 2 }}>
          {t('tracker.cancel.body')}
        </DialogContentText>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          label={t('tracker.cancel.reason')}
          placeholder={t('tracker.cancel.reasonPlaceholder')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          inputProps={{ 'data-testid': 'tracker-cancel-reason' }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} sx={{ minHeight: 44 }}>
          {t('tracker.cancel.keep')}
        </Button>
        <Button
          color="error"
          variant="contained"
          disabled={busy}
          onClick={() => onConfirm(reason.trim())}
          data-testid="tracker-cancel-confirm"
          sx={{ minHeight: 44 }}
        >
          {t('tracker.cancel.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
