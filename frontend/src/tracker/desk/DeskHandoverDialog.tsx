import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { useTranslation } from 'react-i18next';

import { fetchHandoverTargets, handOverChatThread } from '@/tracker/api/tracker';

/**
 * ПЕРЕДАТЬ ДИАЛОГ ЧЕЛОВЕКУ, а не отделу.
 *
 * «Поручение» отдаёт работу отделу, и это правильно для уборки или такси. Но
 * переписку ведёт человек: сказать «ресепшену» — значит не сказать никому
 * конкретно, и у смены это способ потерять гостя, когда каждый думает, что
 * взял другой.
 *
 * Список адресатов приходит с сервера и строится тем же правилом, что и
 * доступ к чату: передать тому, кто переписку не откроет, нельзя.
 */
interface Props {
  threadId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

export function DeskHandoverDialog({ threadId, open, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<string | null>(null);

  const targets = useQuery({
    queryKey: ['tracker', 'handover-targets'],
    queryFn: fetchHandoverTargets,
    enabled: open,
  });

  const pass = useMutation({
    mutationFn: (userId: string) => handOverChatThread(threadId, userId),
    onSuccess: () => {
      setChosen(null);
      onDone();
    },
  });

  const people = targets.data ?? [];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('tracker.desk.handover.title')}</DialogTitle>
      <DialogContent dividers>
        {people.length === 0 ? (
          <Alert severity="info" data-testid="desk-handover-empty">
            {t('tracker.desk.handover.nobody')}
          </Alert>
        ) : (
          <List dense data-testid="desk-handover-list">
            {people.map((person) => (
              <ListItemButton
                key={person.id}
                selected={chosen === person.id}
                onClick={() => setChosen(person.id)}
                data-testid={`desk-handover-person-${person.id}`}
              >
                <ListItemText primary={person.name} />
              </ListItemButton>
            ))}
          </List>
        )}
        {pass.isError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {t('tracker.desk.handover.failed')}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!chosen || pass.isPending}
          onClick={() => chosen && pass.mutate(chosen)}
          data-testid="desk-handover-confirm"
        >
          {t('tracker.desk.handover.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
