import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useTranslation } from 'react-i18next';

import { FLAG_FOR_LANGUAGE, FlagIcon } from '@/kit';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n';
import { useAppTheme } from '@/theme';

/**
 * Настройки витрины на узком экране — ОДНОЙ кнопкой.
 *
 * Раньше язык и тема висели над контентом двумя отдельными кнопками рядом с
 * чипом номера. Полоса получалась широкой, а она `fixed`: при скролле под ней
 * проезжает содержимое любого экрана, и на узком телефоне она накрывала то
 * заголовок, то первую строку списка. Одна круглая кнопка занимает столько же,
 * сколько занимала одна из трёх.
 *
 * Чип номера остался снаружи намеренно: он отвечает на вопрос «кто я сейчас»,
 * то есть читается как СТАТУС, и прятать статус в меню значит заставлять
 * гостя открывать меню, чтобы вспомнить свой номер.
 *
 * Компонент общий для всех гостевых экранов — он живёт в шелле, а не на
 * странице. На десктопе шапка не плавает над контентом и ничего не перекрывает,
 * поэтому там язык и тема остаются отдельными кнопками верхней строки.
 */
export function GuestQuickMenu() {
  const { t, i18n } = useTranslation();
  const { mode, toggleMode } = useAppTheme();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];
  const themeLabel = mode === 'light' ? t('common.dark') : t('common.light');

  return (
    <>
      <IconButton
        aria-label={t('common.settings')}
        aria-haspopup="menu"
        onClick={(event) => setAnchor(event.currentTarget)}
        data-testid="guest-quick-menu"
        sx={{ minWidth: 40, minHeight: 40 }}
      >
        <MoreHorizIcon fontSize="small" />
      </IconButton>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Typography
          variant="caption"
          sx={{ px: 2, pt: 0.5, pb: 0.75, display: 'block', color: 'text.secondary' }}
        >
          {t('common.language')}
        </Typography>
        {SUPPORTED_LANGUAGES.map((code) => {
          const flag = FLAG_FOR_LANGUAGE[code];
          return (
            <MenuItem
              key={code}
              selected={code === current}
              // Идентификаторы те же, что были у отдельного меню языка: путь к
              // действию изменился, само действие — нет.
              data-testid={`guest-language-${code}`}
              onClick={() => {
                void i18n.changeLanguage(code);
                setAnchor(null);
              }}
              sx={{ gap: 1.25 }}
            >
              {flag ? (
                <ListItemIcon sx={{ minWidth: 0 }}>
                  <FlagIcon code={flag} width={23} />
                </ListItemIcon>
              ) : null}
              <ListItemText primaryTypographyProps={{ fontWeight: 600, fontSize: 14 }}>
                {LANGUAGE_LABELS[code as SupportedLanguage]}
              </ListItemText>
            </MenuItem>
          );
        })}

        <MenuItem
          data-testid="theme-toggle"
          onClick={() => {
            toggleMode();
            setAnchor(null);
          }}
          sx={{ gap: 1.25, mt: 0.5, borderTop: 1, borderColor: 'divider', pt: 1.25 }}
        >
          <ListItemIcon sx={{ minWidth: 0 }}>
            {mode === 'light' ? (
              <DarkModeOutlinedIcon fontSize="small" />
            ) : (
              <LightModeOutlinedIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontWeight: 600, fontSize: 14 }}>
            {themeLabel}
          </ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
