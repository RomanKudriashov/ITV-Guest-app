import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { useTranslation } from 'react-i18next';

import type { TrackerPoint } from '../api/types';
import type { LiveStatus } from '../hooks/useBoardLive';

export interface TrackerTopBarProps {
  points: TrackerPoint[];
  selected?: string;
  onSelect: (code: string) => void;
  live: LiveStatus;
  soundEnabled: boolean;
  onToggleSound: () => void;
  /** Total unread guest messages across the hotel's threads. */
  chatUnread?: number;
  onOpenChat?: () => void;
}

/**
 * ПАНЕЛЬ ИНСТРУМЕНТОВ ДОСКИ, А НЕ ШАПКА ПРИЛОЖЕНИЯ.
 *
 * Была `AppBar` — вторая шапка поверх экрана, потому что трекер жил вне общей
 * оболочки. Теперь оболочка одна, и приложенческое в ней уже есть: название
 * отеля, язык, тема, профиль и выход. Дублировать их здесь значило бы держать
 * две кнопки выхода на одном экране.
 *
 * Осталось то, что относится к ДОСКЕ, а не к приложению, и потому обязано
 * стоять рядом с ней: заведение, состояние связи, звук и чат. Заголовок —
 * тем же `cms-page-title`, что у остальных разделов: раздел называется так же,
 * как пункт меню, которым в него пришли.
 *
 * Чего здесь больше нет и почему:
 *   * выход — в меню профиля общей шапки, один на всё приложение;
 *   * кнопка «в CMS» — её заменил сайдбар, который виден всегда;
 *   * язык и тема — в общей шапке.
 */
export function TrackerTopBar({
  points,
  selected,
  onSelect,
  live,
  soundEnabled,
  onToggleSound,
  chatUnread = 0,
  onOpenChat,
}: TrackerTopBarProps) {
  const { t } = useTranslation();

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{ px: 3, pt: 2, pb: 1, flexWrap: 'wrap', rowGap: 1 }}
      data-testid="tracker-toolbar"
    >
      <Typography variant="h5" data-testid="cms-page-title">
        {t('tracker.title')}
      </Typography>

      {points.length ? (
        <Select
          size="small"
          value={selected ?? ''}
          onChange={(event) => onSelect(String(event.target.value))}
          data-testid="tracker-point-select"
          inputProps={{ 'aria-label': t('tracker.point') }}
          sx={{ minWidth: 120, maxWidth: { xs: 168, sm: 260 }, ml: 1 }}
        >
          {points.map((point) => (
            <MenuItem key={point.code} value={point.code}>
              <Badge
                color="error"
                badgeContent={point.new_count || 0}
                sx={{ '& .MuiBadge-badge': { right: -10 } }}
              >
                {point.title}
              </Badge>
            </MenuItem>
          ))}
        </Select>
      ) : null}

      <Box sx={{ flexGrow: 1 }} />

      {/* No point, no connection to miss — the chip would only confuse. */}
      {live === 'offline' && points.length ? (
        <Chip
          size="small"
          color="warning"
          variant="outlined"
          icon={<CloudOffIcon sx={{ fontSize: 16 }} />}
          label={t('tracker.offline')}
          data-testid="tracker-offline"
        />
      ) : null}

      {onOpenChat ? (
        <Tooltip title={t('tracker.chat.title')}>
          <IconButton
            onClick={onOpenChat}
            aria-label={t('tracker.chat.title')}
            data-testid="tracker-chat-open"
            sx={{ minWidth: 44, minHeight: 44 }}
          >
            <Badge color="error" badgeContent={chatUnread} max={99}>
              <ChatBubbleOutlineIcon />
            </Badge>
          </IconButton>
        </Tooltip>
      ) : null}

      <Tooltip title={soundEnabled ? t('tracker.sound.on') : t('tracker.sound.off')}>
        <IconButton
          onClick={onToggleSound}
          color={soundEnabled ? 'primary' : 'default'}
          aria-label={soundEnabled ? t('tracker.sound.on') : t('tracker.sound.off')}
          data-testid="tracker-sound-toggle"
          sx={{ minWidth: 44, minHeight: 44 }}
        >
          {soundEnabled ? <NotificationsActiveIcon /> : <NotificationsOffIcon />}
        </IconButton>
      </Tooltip>
    </Stack>
  );
}
