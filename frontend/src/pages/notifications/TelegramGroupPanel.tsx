import { useTranslation } from 'react-i18next';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { GroupConnect, TelegramGroupState } from '@/api/notificationTypes';

/**
 * TELEGRAM-ГРУППА ЧЕРЕЗ БОТА ПЛАТФОРМЫ — СОСТОЯНИЕ И ПОДКЛЮЧЕНИЕ (партия 32).
 *
 * Токена и chat_id здесь нет: адрес группы ставит бот, когда в группе
 * отправят код. Панель показывает, в каком состоянии группа (ждёт / подключена
 * / бота удалили), и выдаёт код — его прежний вариант при этом гаснет.
 */
export function TelegramGroupPanel({
  group,
  connect,
  onNewCode,
  busy,
}: {
  /** Состояние уже заведённого канала; у нового его ещё нет. */
  group: TelegramGroupState | null | undefined;
  /** Только что выданный код (после создания или «Новый код»). */
  connect: GroupConnect | null;
  onNewCode?: () => void;
  busy?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const state = group?.state ?? (connect ? 'pending' : null);
  const until = connect
    ? new Date(connect.expires_at).toLocaleTimeString(i18n.resolvedLanguage ?? 'ru', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <Stack spacing={1.5} data-testid="cms-group-panel">
      {state ? (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip
            size="small"
            color={state === 'connected' ? 'success' : state === 'removed' ? 'warning' : 'default'}
            label={t(`notifications.group.state.${state}`)}
            data-testid="cms-group-state"
          />
          {group?.chat_title ? (
            <Typography variant="body2" data-testid="cms-group-chat">
              {t('notifications.group.chat', { title: group.chat_title })}
            </Typography>
          ) : null}
        </Stack>
      ) : null}

      {state === 'removed' ? <Alert severity="warning">{t('notifications.group.removedHint')}</Alert> : null}

      {connect ? (
        <Alert severity="info" data-testid="cms-group-connect">
          <Stack spacing={1}>
            <Typography variant="body2">{t('notifications.group.steps', { bot: connect.bot_username || '…' })}</Typography>
            <Typography variant="h6" component="div" sx={{ fontFamily: 'monospace', letterSpacing: 2 }} data-testid="cms-group-code">
              {/* С именем бота: в группе с режимом приватности (так по умолчанию)
                  бот получает только команды, обращённые к нему явно. */}
              {connect.bot_username ? `/connect@${connect.bot_username} ${connect.code}` : `/connect ${connect.code}`}
            </Typography>
            {connect.link ? (
              <Link href={connect.link} target="_blank" rel="noopener noreferrer" data-testid="cms-group-link">
                {t('notifications.group.link')}
              </Link>
            ) : (
              <Typography variant="caption" color="warning.main">
                {t('notifications.group.noBot')}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {t('notifications.group.until', { time: until })}
            </Typography>
          </Stack>
        </Alert>
      ) : null}

      {onNewCode && state !== 'connected' ? (
        <Button size="small" variant="outlined" onClick={onNewCode} disabled={busy} data-testid="cms-group-new-code" sx={{ alignSelf: 'flex-start' }}>
          {t('notifications.group.newCode')}
        </Button>
      ) : null}
    </Stack>
  );
}
