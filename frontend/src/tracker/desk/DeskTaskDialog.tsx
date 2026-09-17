import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { useTrackerLanguage } from '../hooks/useTrackerQueries';
import { fetchDeskPoints, handOverTask } from './api';

/**
 * ЗАДАЧА В ОТДЕЛ. Отдел получает задачу на свою доску — со статусами,
 * просрочкой и эскалацией, — а переписка остаётся у ресепшена. Гостю в чат
 * уходит человеческое «передали в хозслужбу», без номера заказа.
 */
export function DeskTaskDialog({
  threadId,
  open,
  onClose,
  onSent,
}: {
  threadId: string;
  open: boolean;
  onClose: () => void;
  onSent: (title: string) => void;
}) {
  const { t } = useTranslation();
  const language = useTrackerLanguage();
  const queryClient = useQueryClient();
  const [point, setPoint] = useState('');
  const [text, setText] = useState('');

  const points = useQuery({
    queryKey: ['tracker', 'desk', 'points', language],
    queryFn: () => fetchDeskPoints(language),
    enabled: open,
  });

  const send = useMutation({
    mutationFn: () => handOverTask(threadId, point, text.trim()),
    onSuccess: (task) => {
      void queryClient.invalidateQueries({ queryKey: ['tracker', 'chat'] });
      setText('');
      onSent(task.point_title);
    },
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" data-testid="desk-task-dialog">
      <DialogTitle>{t('tracker.desk.task.title')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {t('tracker.desk.task.hint')}
          </Typography>
          <TextField
            select
            size="small"
            label={t('tracker.desk.task.point')}
            value={point}
            onChange={(event) => setPoint(event.target.value)}
            SelectProps={{ SelectDisplayProps: { 'data-testid': 'desk-task-point' } as never }}
          >
            {(points.data?.points ?? []).map((row) => (
              <MenuItem key={row.code} value={row.code} data-testid={`desk-task-point-${row.code}`}>
                {row.public_title}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            multiline
            minRows={3}
            size="small"
            label={t('tracker.desk.task.what')}
            value={text}
            onChange={(event) => setText(event.target.value)}
            inputProps={{ 'data-testid': 'desk-task-text', maxLength: 500 }}
          />
          {send.error ? (
            <Alert severity="error" data-testid="desk-task-error">
              {send.error instanceof Error ? send.error.message : t('tracker.desk.task.failed')}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('tracker.desk.order.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!point || !text.trim() || send.isPending}
          onClick={() => send.mutate()}
          data-testid="desk-task-send"
        >
          {t('tracker.desk.task.send')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
