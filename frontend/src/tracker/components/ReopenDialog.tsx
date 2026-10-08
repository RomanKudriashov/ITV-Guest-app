import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ReopenDialogProps {
  open: boolean;
  orderNumber: number | null;
  /** Название статуса, в который заказ вернут. */
  statusTitle: string | null;
  busy: boolean;
  onClose: () => void;
  /** Причина обязательна (партия 47) — она уходит в историю заказа. */
  onConfirm: (reason: string) => void;
}

/**
 * ВЫХОД ИЗ ЗАКРЫТОГО ЗАКАЗА — ЧЕРЕЗ ВОПРОС.
 *
 * Возврат в работу разрешён намеренно: «Доставлено», нажатое не на той
 * карточке, иначе чинится только правкой в базе. Но у закрытого заказа уже
 * случились последствия — гость увидел «доставлено», смена отчиталась, число
 * ушло в сводку, — и делать это одним касанием нельзя: на кухне по карточкам
 * попадают неточно, и промах по закрытой карточке был бы неотличим от
 * намерения.
 *
 * ПРИЧИНА ОБЯЗАТЕЛЬНА (партия 47, решение тек-лида 24.09). Журнал и так
 * пишет кто, когда, откуда и куда — но не ЗАЧЕМ, а возврат закрытого
 * разбирают именно по этому вопросу. Вернуть может старший смены и выше;
 * исполнителю диалог не открывается вовсе — целей возврата сервер ему не даёт.
 */
export function ReopenDialog({
  open,
  orderNumber,
  statusTitle,
  busy,
  onClose,
  onConfirm,
}: ReopenDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const ready = reason.trim().length > 0;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('tracker.reopen.title', { number: orderNumber ?? '' })}</DialogTitle>
      <DialogContent>
        <DialogContentText variant="body2" data-testid="tracker-reopen-body">
          {t('tracker.reopen.body', { status: statusTitle ?? '' })}
        </DialogContentText>
        <TextField
          autoFocus
          fullWidth
          required
          multiline
          minRows={2}
          margin="dense"
          label={t('tracker.reopen.reason')}
          value={reason}
          onChange={(event) => setReason(event.target.value.slice(0, 255))}
          inputProps={{ 'data-testid': 'tracker-reopen-reason', maxLength: 255 }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} sx={{ minHeight: 44 }}>
          {t('tracker.reopen.keep')}
        </Button>
        <Button
          variant="contained"
          onClick={() => onConfirm(reason.trim())}
          disabled={busy || !ready}
          data-testid="tracker-reopen-confirm"
          sx={{ minHeight: 44 }}
        >
          {t('tracker.reopen.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
