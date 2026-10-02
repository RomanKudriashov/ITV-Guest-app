import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';

import { ApiError } from '@/api/client';
import { fetchTelegramSettings, saveTelegramSettings } from '@/api/notifications';
import { queryKeys } from '@/api/queryKeys';
import { useAuth } from '@/auth';
import { useToast } from '@/components/ToastProvider';

/**
 * Personal Telegram notifications through the platform bot (batch 28): the
 * hotel's switch and whether the bot is online. Staff connect Telegram in
 * their own profile; the per-person state lives on the staff list.
 *
 * Only the hotel admin flips the switch — a service manager sees it read-only.
 */
export function TelegramCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const isHotelAdmin = Boolean(useAuth().user?.is_hotel_admin);
  const query = useQuery({ queryKey: queryKeys.telegramSettings, queryFn: fetchTelegramSettings });

  const save = useMutation({
    mutationFn: saveTelegramSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.telegramSettings, saved);
      toast.show(t(saved.enabled ? 'notifications.telegram.turnedOn' : 'notifications.telegram.turnedOff'), 'success');
    },
    onError: (failure) =>
      toast.show(failure instanceof ApiError ? failure.detail : t('errors.generic'), 'error'),
  });

  const settings = query.data;
  if (!settings) return null;

  return (
    <Card variant="outlined" data-testid="notifications-telegram">
      <CardContent>
        <Stack spacing={1}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
            <Stack spacing={0.25}>
              <Typography variant="subtitle1">{t('notifications.telegram.title')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('notifications.telegram.hint')}
              </Typography>
            </Stack>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.enabled}
                  disabled={!isHotelAdmin || save.isPending}
                  onChange={(event) => save.mutate(event.target.checked)}
                  inputProps={{ 'aria-label': t('notifications.telegram.switch') }}
                  data-testid="notifications-telegram-switch"
                />
              }
              label={t(settings.enabled ? 'common.on' : 'common.off')}
            />
          </Stack>
          {settings.bot.connected ? (
            <Typography variant="body2" color="text.secondary" data-testid="notifications-telegram-bot">
              {t('notifications.telegram.botOnline', { name: settings.bot.username })}
            </Typography>
          ) : (
            <Alert severity="warning" data-testid="notifications-telegram-bot-missing">
              {t('notifications.telegram.botMissing')}
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
