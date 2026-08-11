import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';

import {
  notificationPermission,
  requestNotificationPermission,
} from './orderNotifications';

/**
 * Предложение включить уведомления — ПОСЛЕ оформления заказа.
 *
 * Показывается ровно в одном состоянии: браузер уведомления умеет, и гость
 * ещё не отвечал (`default`). Не умеет — здесь не появляется ничего: обещать
 * то, чего не будет, хуже, чем не обещать.
 *
 * Отказ ничего не ломает и не повторяется: браузер запоминает его сам, и
 * второй раз спросить нельзя даже при желании. Статус заказа остаётся на этом
 * же экране — уведомление ускоряет, а не заменяет.
 */
export function NotificationsOptIn() {
  const { t } = useTranslation();
  const [state, setState] = useState(notificationPermission);
  const [asking, setAsking] = useState(false);

  if (state !== 'default') return null;

  const ask = async () => {
    setAsking(true);
    setState(await requestNotificationPermission());
    setAsking(false);
  };

  return (
    <Box
      data-testid="guest-notifications-optin"
      sx={{
        p: 1.5,
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'action.hover',
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        <NotificationsActiveIcon fontSize="small" color="action" />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2">{t('guest.notifications.offer')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('guest.notifications.offerHint')}
          </Typography>
        </Box>
        <Button
          size="small"
          variant="outlined"
          onClick={ask}
          disabled={asking}
          data-testid="guest-notifications-enable"
        >
          {t('guest.notifications.enable')}
        </Button>
      </Stack>
    </Box>
  );
}
