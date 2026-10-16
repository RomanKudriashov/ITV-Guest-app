import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { useTranslation } from 'react-i18next';

import { SelectField } from '@/components/SelectField';

export interface TransferDialogProps {
  open: boolean;
  orderNumber: number | null;
  /** Куда можно передать — отдаёт сервер вместе с доской (`transfer_targets`). */
  targets: Array<{ code: string; title: string }>;
  busy: boolean;
  onClose: () => void;
  onConfirm: (point: string, reason: string) => void;
}

/**
 * ПЕРЕДАТЬ ЗАКАЗ НА ДРУГУЮ ТОЧКУ (партия 48) — старший смены и выше.
 *
 * Точка-цель и ПРИЧИНА — обязательны: перенос пишется в журнал заказа, и на
 * новой доске его разбирают по вопросу «почему он здесь». На новой точке заказ
 * начинает с начального статуса, ничьим, норма времени — от переноса.
 */
export function TransferDialog({
  open,
  orderNumber,
  targets,
  busy,
  onClose,
  onConfirm,
}: TransferDialogProps) {
  const { t } = useTranslation();
  const [point, setPoint] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) {
      setPoint('');
      setReason('');
    }
  }, [open]);
  const ready = Boolean(point) && reason.trim().length > 0;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('tracker.transfer.title', { number: orderNumber ?? '' })}</DialogTitle>
      <DialogContent>
        <DialogContentText variant="body2" sx={{ mb: 1 }}>
          {t('tracker.transfer.body')}
        </DialogContentText>
        <SelectField
          required
          label={t('tracker.transfer.point')}
          value={point}
          onChange={setPoint}
          testId="tracker-transfer-point"
          // margin="dense" у TextField — те же отступы руками.
          sx={{ mt: 1, mb: 0.5 }}
          options={targets.map((target) => ({
            value: target.code,
            label: target.title,
            testId: `tracker-transfer-point-${target.code}`,
          }))}
        />
        <TextField
          fullWidth
          required
          multiline
          minRows={2}
          margin="dense"
          label={t('tracker.transfer.reason')}
          value={reason}
          onChange={(event) => setReason(event.target.value.slice(0, 255))}
          inputProps={{ 'data-testid': 'tracker-transfer-reason', maxLength: 255 }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} sx={{ minHeight: 44 }}>
          {t('tracker.transfer.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={() => onConfirm(point, reason.trim())}
          disabled={busy || !ready}
          data-testid="tracker-transfer-confirm"
          sx={{ minHeight: 44 }}
        >
          {t('tracker.transfer.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
