import AppBar from '@mui/material/AppBar';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import LogoutIcon from '@mui/icons-material/Logout';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { useAuth } from '@/auth';
import type { TrackerPoint } from '../api/types';
import type { LiveStatus } from '../hooks/useBoardLive';

export interface TrackerTopBarProps {
  points: TrackerPoint[];
  selected?: string;
  onSelect: (code: string) => void;
  live: LiveStatus;
  soundEnabled: boolean;
  onToggleSound: () => void;
}

export function TrackerTopBar({
  points,
  selected,
  onSelect,
  live,
  soundEnabled,
  onToggleSound,
}: TrackerTopBarProps) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();

  return (
    <AppBar
      position="sticky"
      color="inherit"
      sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}
    >
      <Toolbar sx={{ gap: 1, minHeight: { xs: 56, sm: 64 } }}>
        <Typography variant="h6" sx={{ display: { xs: 'none', sm: 'block' } }}>
          {t('tracker.title')}
        </Typography>

        {points.length ? (
          <Select
            size="small"
            value={selected ?? ''}
            onChange={(event) => onSelect(String(event.target.value))}
            data-testid="tracker-point-select"
            inputProps={{ 'aria-label': t('tracker.point') }}
            sx={{ minWidth: 120, maxWidth: { xs: 168, sm: 260 } }}
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

        <Tooltip title={t('tracker.toCms')}>
          <IconButton
            onClick={() => navigate('/cms/menu')}
            aria-label={t('tracker.toCms')}
            data-testid="tracker-to-cms"
            sx={{ minWidth: 44, minHeight: 44 }}
          >
            <RestaurantMenuIcon />
          </IconButton>
        </Tooltip>

        <Stack direction="row" sx={{ display: { xs: 'none', md: 'flex' } }}>
          <LanguageSwitcher compact />
          <ThemeModeToggle />
        </Stack>

        <Tooltip title={t('auth.logout')}>
          <IconButton
            onClick={logout}
            aria-label={t('auth.logout')}
            data-testid="tracker-logout"
            sx={{ minWidth: 44, minHeight: 44 }}
          >
            <LogoutIcon />
          </IconButton>
        </Tooltip>
      </Toolbar>
    </AppBar>
  );
}
