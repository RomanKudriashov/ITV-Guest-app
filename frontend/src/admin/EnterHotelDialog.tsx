import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
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

import { ink, primaryButtonSx, state } from './adminTokens';
import { enterHotel, PlatformError, type EnterResult } from './adminClient';

const TTL_CHOICES = [15, 30, 60];

/**
 * Вход в отель от лица платформы.
 *
 * Причина обязательна, а срок конечен — и то и другое не формальность. Журнал
 * без причины отвечает «кто и когда», но не «зачем», а разбирают инциденты
 * именно по «зачем». Бессрочный же доступ ко всем данным отеля — это не вход
 * поддержки, а второй постоянный владелец отеля.
 */
export function EnterHotelDialog({
  hotelId,
  hotelName,
  onClose,
}: {
  hotelId: string;
  hotelName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [ttl, setTtl] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState<EnterResult | null>(null);

  const enter = useMutation({
    mutationFn: () => enterHotel(hotelId, { reason: reason.trim(), ttl_minutes: ttl }),
    onSuccess: setGranted,
    onError: (e) => setError(e instanceof PlatformError ? e.message : t('admin.enter.failed')),
  });

  if (granted) {
    return <GrantedView granted={granted} hotelName={hotelName} onClose={onClose} />;
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="admin-enter-dialog">
      <DialogTitle>{t('admin.enter.title', { hotel: hotelName })}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography sx={{ fontSize: 12.5, color: ink.mid }}>{t('admin.enter.hint')}</Typography>
          {error ? <Alert severity="error" data-testid="admin-enter-error">{error}</Alert> : null}
          <TextField
            label={t('admin.enter.reason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            multiline
            minRows={2}
            inputProps={{ 'data-testid': 'admin-enter-reason' }}
          />
          <TextField
            select
            label={t('admin.enter.ttl')}
            value={ttl}
            onChange={(e) => setTtl(Number(e.target.value))}
            SelectProps={{ inputProps: { 'data-testid': 'admin-enter-ttl' } }}
          >
            {TTL_CHOICES.map((minutes) => (
              <MenuItem key={minutes} value={minutes}>
                {t('admin.enter.minutes', { minutes })}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: ink.mid }}>
          {t('admin.actions.cancel')}
        </Button>
        <Button
          disabled={reason.trim().length < 3 || enter.isPending}
          onClick={() => enter.mutate()}
          data-testid="admin-enter-submit"
          sx={primaryButtonSx}
        >
          {t('admin.enter.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function GrantedView({
  granted,
  hotelName,
  onClose,
}: {
  granted: EnterResult;
  hotelName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(() => secondsLeft(granted.expires_at));

  // Таймер идёт на глазах: доступ ко всему отелю не должен тихо висеть, пока
  // о нём забыли. Когда время вышло, это видно здесь, а не только на сервере.
  useEffect(() => {
    const timer = window.setInterval(() => setLeft(secondsLeft(granted.expires_at)), 1000);
    return () => window.clearInterval(timer);
  }, [granted.expires_at]);

  const expired = left <= 0;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="admin-enter-granted">
      <DialogTitle>{t('admin.enter.grantedTitle', { hotel: hotelName })}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <Typography sx={{ fontSize: 12.5, color: ink.mid }}>
            {t('admin.enter.asUser', { email: granted.as_user })}
          </Typography>
          <Typography
            data-testid="admin-enter-timer"
            sx={{ fontSize: 18, fontWeight: 800, color: expired ? state.bad : state.warn }}
          >
            {expired ? t('admin.enter.expired') : t('admin.enter.left', { time: format(left) })}
          </Typography>
          <Alert severity="info" data-testid="admin-enter-audited">
            {t('admin.enter.audited')}
          </Alert>
          <Box sx={{ fontSize: 12, color: ink.low }}>{granted.cms_url}</Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: ink.mid }}>
          {t('admin.actions.done')}
        </Button>
        <Button
          disabled={expired}
          onClick={() => {
            // Токен кладём в адрес, а не в общее хранилище: сессия поддержки
            // живёт во вкладке отеля и не подменяет собой вход платформы.
            const url = `${granted.cms_url}?support=${encodeURIComponent(granted.access)}`;
            window.open(url, '_blank', 'noreferrer');
          }}
          data-testid="admin-enter-open"
          sx={primaryButtonSx}
        >
          {t('admin.enter.open')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function secondsLeft(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
}

function format(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
