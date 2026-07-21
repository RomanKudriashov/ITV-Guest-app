import { useTranslation } from 'react-i18next';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';

import { useAppTheme } from '@/theme';

export function ThemeModeToggle() {
  const { mode, toggleMode } = useAppTheme();
  const { t } = useTranslation();
  const label = mode === 'light' ? t('common.dark') : t('common.light');

  return (
    <Tooltip title={label}>
      <IconButton onClick={toggleMode} aria-label={label} data-testid="theme-toggle">
        {mode === 'light' ? (
          <DarkModeOutlinedIcon fontSize="small" />
        ) : (
          <LightModeOutlinedIcon fontSize="small" />
        )}
      </IconButton>
    </Tooltip>
  );
}
