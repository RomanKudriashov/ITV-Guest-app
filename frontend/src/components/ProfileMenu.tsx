import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import LogoutIcon from '@mui/icons-material/Logout';
import { alpha, darken, lighten, type Theme } from '@mui/material/styles';

/**
 * Предупреждение КАК ТЕКСТ, а не как заливка.
 *
 * `warning.main` темы рассчитан на роль заливки: на светлой поверхности он даёт
 * 3.1:1 — живой обход экрана поймал ровно это на строке «Второй фактор
 * выключен». Тот же сдвиг, что делает `createAppTheme` для `primaryStrong`:
 * глубже на светлой, светлее на тёмной.
 */
const warningInk = (theme: Theme) =>
  theme.palette.mode === 'dark'
    ? lighten(theme.palette.warning.main, 0.1)
    : darken(theme.palette.warning.main, 0.4);

export interface ProfileMenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

export interface ProfileMenuProps {
  /** Адрес входа. Показывается целиком в меню, а не обрезком в панели. */
  email: string;
  /** Роль под адресом. */
  role: string;
  items: ProfileMenuItem[];
  onLogout: () => void;
  logoutLabel: string;
  /** Префикс `data-testid`: `cms` или `admin`. */
  testIdPrefix: string;
  /**
   * Постоянное предупреждение об учётке — сегодня это «второй фактор не
   * включён». Метка на монограмме видна ВСЕГДА, текст открывается в меню:
   * признак нельзя было прятать целиком, он и заводился ради того, чтобы
   * мозолить глаза владельцу мастер-ключа.
   */
  warning?: { label: string; testId?: string } | null;
}

/**
 * Блок профиля в ШАПКЕ — общий для консоли и CMS.
 *
 * До этого он жил в двух видах и ни один не работал. В консоли — прибит к низу
 * боковой панели в колонку 73px шириной: адрес обрезался (`platform@itv.local`
 * требовал 109px), роль и признак второго фактора ломались на две строки
 * каждый, и блок читался лесенкой. В CMS — текстовая ссылка в шапке рядом с
 * отдельной иконкой выхода: выход стоял снаружи и на узком экране первым
 * попадал под палец.
 *
 * ПОЧЕМУ МЕНЮ, А НЕ ПЛАШКА. Адрес входа — это не постоянно нужная информация,
 * а справка «под кем я сижу»: смотрят её раз в сессию, а место она занимает
 * всегда, и именно из-за нехватки места ломалась вёрстка. В свёрнутом виде
 * достаточно монограммы; развёрнутое меню места не занимает и потому может
 * показать адрес ЦЕЛИКОМ, без `noWrap` и без многоточия.
 *
 * Цвет берётся из темы MUI, а не из словаря консоли: на `/admin` тема — тот же
 * платформенный дефолт, из которого выведен словарь, поэтому один и тот же
 * компонент выглядит на месте в обеих оболочках и не заводит третьего набора
 * значений.
 */
export function ProfileMenu({
  email,
  role,
  items,
  onLogout,
  logoutLabel,
  testIdPrefix,
  warning = null,
}: ProfileMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);

  // Монограмма: две буквы адреса. Аватара у платформенной учётки нет и не
  // предвидится — заводить ради него загрузку файла было бы отдельным продуктом.
  const initials = (email || '?').slice(0, 2).toUpperCase();

  return (
    <>
      <Tooltip title={warning ? `${email} — ${warning.label}` : email || role}>
        <ButtonBase
          onClick={(event) => setAnchor(event.currentTarget)}
          data-testid={`${testIdPrefix}-profile-button`}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchor)}
          aria-label={warning ? `${email} — ${warning.label}` : email}
          sx={(theme: Theme) => ({
            position: 'relative',
            width: 36,
            height: 36,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontSize: 12.5,
            fontWeight: theme.typography.fontWeightBold,
            color: theme.palette.primary.contrastText,
            backgroundColor: theme.palette.primary.main,
            transition: 'filter .18s',
            '&:hover': { filter: 'brightness(1.08)' },
            '&.Mui-focusVisible': {
              outline: `2px solid ${theme.palette.primary.main}`,
              outlineOffset: 2,
            },
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          })}
        >
          {initials}
          {warning ? (
            <Box
              aria-hidden
              data-testid={warning.testId}
              sx={(theme: Theme) => ({
                position: 'absolute',
                top: -1,
                insetInlineEnd: -1,
                width: 11,
                height: 11,
                borderRadius: '50%',
                backgroundColor: theme.palette.warning.main,
                border: `2px solid ${theme.palette.background.paper}`,
              })}
            />
          ) : null}
        </ButtonBase>
      </Tooltip>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        data-testid={`${testIdPrefix}-profile-menu`}
        slotProps={{
          paper: {
            sx: (theme: Theme) => ({
              mt: 1,
              minWidth: 248,
              maxWidth: 320,
              borderRadius: `${theme.palette.brand.radius.md}px`,
              border: `1px solid ${theme.palette.divider}`,
              backgroundColor: theme.palette.background.paper,
              boxShadow: theme.palette.brand.elevation.md,
            }),
          },
        }}
      >
        {/*
          Шапка меню — не пункт: по ней не кликают. Адрес переносится по
          символам, а не обрезается: половина адреса не отвечает на вопрос,
          ради которого сюда зашли.
        */}
        <Box sx={{ px: 2, pt: 1.25, pb: 1.25 }}>
          <Typography
            data-testid={`${testIdPrefix}-profile-email`}
            sx={(theme: Theme) => ({
              fontSize: 13.5,
              fontWeight: theme.typography.fontWeightMedium,
              color: theme.palette.text.primary,
              lineHeight: 1.4,
              wordBreak: 'break-all',
            })}
          >
            {email}
          </Typography>
          <Typography
            data-testid={`${testIdPrefix}-profile-role`}
            sx={(theme: Theme) => ({
              fontSize: 12,
              color: theme.palette.text.secondary,
              lineHeight: 1.4,
              mt: 0.25,
            })}
          >
            {role}
          </Typography>
          {warning ? (
            <Typography
              sx={(theme: Theme) => ({
                mt: 0.75,
                fontSize: 11.5,
                fontWeight: theme.typography.fontWeightBold,
                color: warningInk(theme),
                lineHeight: 1.4,
              })}
            >
              {warning.label}
            </Typography>
          ) : null}
        </Box>

        <Divider />

        {items.map((item) => (
          <MenuItem
            key={item.key}
            onClick={() => {
              close();
              item.onSelect();
            }}
            data-testid={`${testIdPrefix}-profile-${item.key}`}
            sx={{ py: 1, fontSize: 13.5 }}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>{item.icon}</ListItemIcon>
            {item.label}
          </MenuItem>
        ))}

        <Divider />

        {/*
          Выход отделён чертой и покрашен отказом: это единственный пункт,
          после которого работа прерывается, и нажатие мимо стоит дороже
          остальных.
        */}
        <MenuItem
          onClick={() => {
            close();
            onLogout();
          }}
          data-testid={`${testIdPrefix}-logout`}
          sx={(theme: Theme) => ({
            py: 1,
            fontSize: 13.5,
            color: theme.palette.error.main,
            '&:hover': { backgroundColor: alpha(theme.palette.error.main, 0.1) },
          })}
        >
          <ListItemIcon sx={{ minWidth: 32 }}>
            <LogoutIcon fontSize="small" sx={{ color: 'error.main' }} />
          </ListItemIcon>
          {logoutLabel}
        </MenuItem>
      </Menu>
    </>
  );
}
