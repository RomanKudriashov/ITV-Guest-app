import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import AutoAwesomeMosaicOutlinedIcon from '@mui/icons-material/AutoAwesomeMosaicOutlined';
import { useTranslation } from 'react-i18next';

import { surfaceRadius } from '../storefrontTokens';
import { useStorefront } from '../useStorefront';
import type { MenuView } from './menuViewStore';

const OPTIONS: { value: MenuView; Icon: typeof GridViewOutlinedIcon }[] = [
  { value: 'cards', Icon: GridViewOutlinedIcon },
  { value: 'mosaic', Icon: AutoAwesomeMosaicOutlinedIcon },
];

/**
 * ПЕРЕКЛЮЧАТЕЛЬ ВИДА МЕНЮ (партия 57) — «пилюля» из двух контурных иконок в
 * шапке заведения, на телефоне там же.
 *
 * Лежит поверх кадра заведения, поэтому стекло чипа и белые иконки — как у
 * «К сервисам» и статуса часов рядом. Одно стекло на экран — не десятки, как
 * было бы на плитках.
 *
 * Кнопки — настоящие `<button>` с `aria-pressed`: экранный диктор читает
 * «Мозаика, нажата», а не две безымянные картинки. Подсказка — та же строка,
 * что и `aria-label`.
 */
export function MenuViewToggle({ value, onChange }: { value: MenuView; onChange: (view: MenuView) => void }) {
  const { t } = useTranslation();
  const { glass, onMedia } = useStorefront();
  return (
    <Box
      role="group"
      aria-label={t('guest.menu.view.group')}
      data-testid="guest-menu-view-toggle"
      data-view={value}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        p: 0.375,
        borderRadius: (theme) => surfaceRadius.pill(theme.palette.brand.radius),
        ...glass.chip,
      }}
    >
      {OPTIONS.map(({ value: option, Icon }) => {
        const pressed = value === option;
        const label = t(`guest.menu.view.${option}`);
        return (
          <Tooltip key={option} title={label}>
            <Box
              component="button"
              type="button"
              aria-label={label}
              aria-pressed={pressed}
              data-testid={`guest-menu-view-${option}`}
              onClick={() => onChange(option)}
              sx={(theme) => ({
                width: 36,
                height: 36,
                display: 'grid',
                placeItems: 'center',
                border: 'none',
                cursor: 'pointer',
                borderRadius: surfaceRadius.pill(theme.palette.brand.radius),
                color: pressed ? theme.palette.primary.contrastText : onMedia.primary,
                bgcolor: pressed ? theme.palette.primary.main : 'transparent',
                transition: 'background-color .15s',
                '&:hover': { bgcolor: pressed ? theme.palette.primary.main : onMedia.hover },
                '&:focus-visible': { outline: `2px solid ${onMedia.primary}`, outlineOffset: 1 },
              })}
            >
              <Icon sx={{ fontSize: 20 }} />
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
