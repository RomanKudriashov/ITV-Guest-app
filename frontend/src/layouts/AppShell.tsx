import { useTranslation } from 'react-i18next';

import { ScreenBoundary } from '@/components/ScreenBoundary';

import { NavLink, Outlet, useLocation } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { useState } from 'react';
import Drawer from '@mui/material/Drawer';
import MenuIcon from '@mui/icons-material/Menu';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { Theme } from '@mui/material/styles';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import RoomServiceIcon from '@mui/icons-material/RoomService';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import InsightsIcon from '@mui/icons-material/Insights';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';

import { IconBrand } from '@/icons';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { useAuth } from '@/auth';
import { useNavigation } from '@/hooks/useNavigation';
import { useBootstrap } from '@/hooks/useBootstrap';
import type { SupportSession } from '@/api/types';

const DRAWER_WIDTH = 248;

/**
 * Иконка на ключ раздела. Сам СПИСОК разделов приходит с сервера
 * (`useNavigation`): гейтинг модулями и роль решаются на бэкенде, и держать
 * здесь второй список значило бы держать два источника правды о том, что у
 * отеля есть.
 */
const NAV_ICONS: Record<string, JSX.Element> = {
  dashboard: <DashboardCustomizeIcon fontSize="small" />,
  tracker: <ReceiptLongIcon fontSize="small" />,
  services: <RoomServiceIcon fontSize="small" />,
  rooms: <MeetingRoomIcon fontSize="small" />,
  staff: <PeopleAltIcon fontSize="small" />,
  brand: <PaletteOutlinedIcon fontSize="small" />,
  analytics: <InsightsIcon fontSize="small" />,
  settings: <SettingsIcon fontSize="small" />,
  notifications: <NotificationsActiveIcon fontSize="small" />,
  dictionaries: <ScienceOutlinedIcon fontSize="small" />,
  marketing: <LocalOfferOutlinedIcon fontSize="small" />,
  roomControl: <BoltOutlinedIcon fontSize="small" />,
  payments: <PaymentsOutlinedIcon fontSize="small" />,
  pms: <GridViewOutlinedIcon fontSize="small" />,
  mobileKey: <IconBrand size={20} />,
};

const FALLBACK_ICON = <GroupWorkIcon fontSize="small" />;

export function AppShell() {
  const location = useLocation();
  const { t } = useTranslation();
  const { user, hotel, logout } = useAuth();
  const { data: bootstrap } = useBootstrap();
  const navigation = useNavigation();
  const isNarrow = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const [navOpen, setNavOpen] = useState(false);

  const hotelName = bootstrap?.hotel?.name ?? hotel?.name ?? t('app.title');

  const support = bootstrap?.support_session ?? null;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/*
        ЧУЖОЕ ПРИСУТСТВИЕ. Пока поддержка внутри отеля, отель обязан это
        видеть — и видеть постоянно, а не в разделе, куда надо зайти.
        Полоса закреплена над всем интерфейсом, закрыть её нечем: механизм
        входа под аудитом строился ради разделимости действий, а сторона,
        которую защищают, о вторжении не знала вовсе.
      */}
      {support ? <SupportPresenceBar session={support} /> : null}
      <AppBar
        position="fixed"
        color="inherit"
        sx={{
          zIndex: (theme) => theme.zIndex.drawer + 1,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Toolbar sx={{ gap: 2 }}>
          {/*
            На узком экране навигация уезжает в выдвижную панель: постоянная
            занимала 246px из 390 и оставляла контенту колонку в одно слово.
            Видно её только там, где она нужна, — на широком экране панель
            и так открыта.
          */}
          <IconButton
            onClick={() => setNavOpen(true)}
            data-testid="nav-toggle"
            aria-label={t('nav.open')}
            sx={{ display: { xs: 'inline-flex', md: 'none' }, ml: -1 }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1 }} data-testid="hotel-name">
            {hotelName}
          </Typography>
          <LanguageSwitcher compact />
          <ThemeModeToggle />
          <Divider orientation="vertical" flexItem sx={{ my: 1.5 }} />
          <Stack sx={{ textAlign: 'end', display: { xs: 'none', md: 'block' } }}>
            <Typography variant="body2">{user?.full_name || user?.email}</Typography>
            <Typography variant="caption" color="text.secondary">
              {user?.is_hotel_admin ? t('nav.roleAdmin') : t('nav.roleStaff')}
            </Typography>
          </Stack>
          <Tooltip title={t('auth.logout')}>
            <IconButton onClick={logout} data-testid="logout-button" aria-label={t('auth.logout')}>
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Drawer
        variant={isNarrow ? 'temporary' : 'permanent'}
        open={isNarrow ? navOpen : true}
        onClose={() => setNavOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          width: isNarrow ? 0 : DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            borderRight: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          },
        }}
      >
        <Toolbar />
        <List sx={{ px: 1.5, py: 2 }} data-testid="main-nav" onClick={() => setNavOpen(false)}>
          {(navigation.data?.groups ?? []).map((group) => (
            <Box key={group.key} sx={{ mb: 1.5 }} data-testid={`nav-group-${group.key}`}>
              {/*
                Заголовок группы — не украшение: он и есть починка «плоской
                простыни». Шестнадцать равнозначных пунктов подряд читаются
                как свалка, потому что не отвечают на вопрос «где искать».
              */}
              <Typography
                variant="overline"
                sx={{ px: 2, color: 'text.secondary', letterSpacing: '.08em' }}
              >
                {t(`nav.groups.${group.key}`)}
              </Typography>

              {group.items.map((item) => (
                <ListItemButton
                  key={item.key}
                  component={NavLink}
                  to={item.to}
                  data-testid={`cms-nav-${item.key}`}
                  sx={{
                    borderRadius: 2,
                    mb: 0.5,
                    '&.active': {
                      bgcolor: 'brand.surfaceSelected',
                      color: 'primary.main',
                      '& .MuiListItemIcon-root': { color: 'primary.main' },
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {NAV_ICONS[item.key] ?? FALLBACK_ICON}
                  </ListItemIcon>
                  <ListItemText
                    primary={t(`nav.${item.key}`)}
                    primaryTypographyProps={{ variant: 'body2' }}
                  />
                </ListItemButton>
              ))}
            </Box>
          ))}
        </List>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
        <Toolbar />
        {/*
          Граница вокруг СОДЕРЖИМОГО, а не вокруг всего приложения: рельс
          разделов обязан пережить падение экрана, иначе уйти с него можно
          только через адресную строку. Ключ по адресу — переход в другой
          раздел считается новой попыткой.
        */}
        <ScreenBoundary
          key={location.pathname}
          message={t('state.crashed')}
          actionLabel={t('state.reload')}
        >
          <Outlet />
        </ScreenBoundary>
      </Box>
    </Box>
  );
}

/**
 * Полоса присутствия поддержки. Без кнопки закрытия и без кнопки обрыва:
 * отель ВИДИТ сессию, но не рвёт её — иначе разбор инцидента блокируется
 * изнутри того самого отеля, который разбирают.
 */
function SupportPresenceBar({ session }: { session: SupportSession }) {
  const { t, i18n } = useTranslation();
  const time = (iso: string) =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'ru', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  return (
    <Box
      data-testid="cms-support-presence"
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: (theme) => theme.zIndex.drawer + 2,
        px: 2,
        py: 0.75,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        fontSize: 13,
        fontWeight: 600,
        color: 'warning.contrastText',
        bgcolor: 'warning.main',
      }}
    >
      {t('app.supportPresence', {
        actor: session.actor,
        from: time(session.started_at),
        until: time(session.expires_at),
      })}
    </Box>
  );
}
