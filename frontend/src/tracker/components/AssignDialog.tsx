import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import { useTranslation } from 'react-i18next';

import type { TrackerAssignee } from '../api/types';

export interface AssignDialogProps {
  open: boolean;
  orderNumber: number | null;
  /** Сейчас назначенный — отмечен заранее. */
  currentId: string | null;
  /** Люди ЭТОЙ точки — их отдаёт сервер вместе с доской (`assignees`). */
  people: TrackerAssignee[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (assigneeId: string) => void;
}

/**
 * НАЗНАЧИТЬ ИСПОЛНИТЕЛЯ (партия 47) — старший смены, руководитель, администратор.
 *
 * Выбор — только из людей точки заказа: это тот же список, что у фильтра
 * «по исполнителю», и сервер проверяет то же самое (`assignee_not_on_point`).
 * Назначение — не «принято»: статус не меняется, эскалация идёт, пока
 * назначенный сам не нажмёт «Принять».
 */
export function AssignDialog({
  open,
  orderNumber,
  currentId,
  people,
  busy,
  onClose,
  onConfirm,
}: AssignDialogProps) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string>('');
  useEffect(() => {
    if (open) setPicked(currentId ?? '');
  }, [open, currentId]);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('tracker.assign.title', { number: orderNumber ?? '' })}</DialogTitle>
      <DialogContent>
        {people.length ? (
          <RadioGroup
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
            data-testid="tracker-assign-people"
          >
            {people.map((person) => (
              <FormControlLabel
                key={person.id}
                value={person.id}
                control={<Radio />}
                label={person.name}
                data-testid={`tracker-assign-person-${person.id}`}
              />
            ))}
          </RadioGroup>
        ) : (
          <DialogContentText variant="body2">{t('tracker.assign.empty')}</DialogContentText>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} sx={{ minHeight: 44 }}>
          {t('tracker.assign.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={() => onConfirm(picked)}
          disabled={busy || !picked || picked === currentId}
          data-testid="tracker-assign-confirm"
          sx={{ minHeight: 44 }}
        >
          {t('tracker.assign.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
