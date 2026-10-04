import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useTranslation } from 'react-i18next';

import { useDraftState } from '@/state/useDraftState';

import { CANCEL_REASONS, type CancelReasonCode } from '../cancelReasons';

export interface CancelDialogProps {
  open: boolean;
  orderNumber: number | null;
  orderId: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (cancelReason: CancelReasonCode, reason: string) => void;
}

/**
 * Причина — КОД из справочника (обязателен, без него кнопка не жмётся) и
 * уточнение текстом по желанию: так её ждёт сервер (партия 31, DEV-01).
 *
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
  const [code, setCode] = useDraftState<CancelReasonCode | ''>(() => '', `code:${orderId ?? 'none'}`);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('tracker.cancel.title', { number: orderNumber ?? '' })}</DialogTitle>
      <DialogContent>
        <DialogContentText variant="body2" sx={{ mb: 2 }}>
          {t('tracker.cancel.body')}
        </DialogContentText>
        <TextField
          select
          autoFocus
          fullWidth
          required
          label={t('tracker.cancel.reasonCode')}
          value={code}
          onChange={(event) => setCode(event.target.value as CancelReasonCode)}
          helperText={code ? ' ' : t('tracker.cancel.reasonRequired')}
          sx={{ mb: 2 }}
          SelectProps={{ SelectDisplayProps: { 'data-testid': 'tracker-cancel-reason-code' } as object }}
        >
          {CANCEL_REASONS.map((item) => (
            <MenuItem key={item} value={item} data-testid={`tracker-cancel-reason-${item}`}>
              {t(`tracker.cancel.reasons.${item}`)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
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
          disabled={busy || !code}
          onClick={() => code && onConfirm(code, reason.trim())}
          data-testid="tracker-cancel-confirm"
          sx={{ minHeight: 44 }}
        >
          {t('tracker.cancel.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
