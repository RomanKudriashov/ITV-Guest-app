import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useTranslation } from 'react-i18next';

export interface ReopenDialogProps {
  open: boolean;
  orderNumber: number | null;
  /** Название статуса, в который заказ вернут. */
  statusTitle: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
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
 * Вопрос без поля причины: причина уже записана журналом (кто, когда, откуда,
 * куда), а лишнее поле в спешке заполняют мусором.
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

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('tracker.reopen.title', { number: orderNumber ?? '' })}</DialogTitle>
      <DialogContent>
        <DialogContentText variant="body2" data-testid="tracker-reopen-body">
          {t('tracker.reopen.body', { status: statusTitle ?? '' })}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} sx={{ minHeight: 44 }}>
          {t('tracker.reopen.keep')}
        </Button>
        <Button
          variant="contained"
          onClick={onConfirm}
          disabled={busy}
          data-testid="tracker-reopen-confirm"
          sx={{ minHeight: 44 }}
        >
          {t('tracker.reopen.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
