import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import RoomServiceIcon from '@mui/icons-material/RoomService';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import InsightsIcon from '@mui/icons-material/Insights';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import PlaceIcon from '@mui/icons-material/Place';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';

import { IconBrand } from '@/icons';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { useAuth } from '@/auth';
import { useBootstrap } from '@/hooks/useBootstrap';

const DRAWER_WIDTH = 248;

interface NavEntry {
  key: string;
  to?: string;
  icon: JSX.Element;
  disabled?: boolean;
  /** Overrides the default `nav-<key>` testid where a screen names its own. */
  testId?: string;
}

const NAV_ENTRIES: NavEntry[] = [
  { key: 'menu', to: '/cms/menu', icon: <RestaurantMenuIcon fontSize="small" /> },
  // The tracker lives outside /cms (own mobile-first shell) but is reachable
  // from here: after one login a member of staff must find both halves.
  { key: 'tracker', to: '/tracker', icon: <DashboardCustomizeIcon fontSize="small" /> },
  {
    key: 'notifications',
    to: '/cms/notifications',
    icon: <NotificationsActiveIcon fontSize="small" />,
    testId: 'cms-nav-notifications',
  },
  {
    key: 'rooms',
    to: '/cms/rooms',
    icon: <MeetingRoomIcon fontSize="small" />,
    testId: 'cms-nav-rooms',
  },
  {
    key: 'locations',
    to: '/cms/locations',
    icon: <PlaceIcon fontSize="small" />,
    testId: 'cms-nav-locations',
  },
  {
    key: 'departments',
    to: '/cms/departments',
    icon: <GroupWorkIcon fontSize="small" />,
    testId: 'cms-nav-departments',
  },
  {
    key: 'staff',
    to: '/cms/staff',
    icon: <PeopleAltIcon fontSize="small" />,
    testId: 'cms-nav-staff',
  },
  {
    key: 'brand',
    to: '/cms/brand',
    icon: <PaletteOutlinedIcon fontSize="small" />,
    testId: 'cms-nav-brand',
  },
  {
    key: 'styleguide',
    to: '/cms/styleguide',
    icon: <IconBrand size={20} />,
    testId: 'cms-styleguide-nav',
  },
  {
    key: 'analytics',
    to: '/cms/analytics',
    icon: <InsightsIcon fontSize="small" />,
    testId: 'cms-analytics-nav',
  },
  {
    key: 'commerce',
    to: '/cms/commerce',
    icon: <PaymentsOutlinedIcon fontSize="small" />,
    testId: 'cms-nav-commerce',
  },
  {
    key: 'badges',
    to: '/cms/badges',
    icon: <LocalOfferOutlinedIcon fontSize="small" />,
    testId: 'cms-nav-badges',
  },
  {
    key: 'quickActions',
    to: '/cms/quick-actions',
    icon: <BoltOutlinedIcon fontSize="small" />,
    testId: 'cms-nav-quick-actions',
  },
  { key: 'orders', icon: <ReceiptLongIcon fontSize="small" />, disabled: true },
  { key: 'services', icon: <RoomServiceIcon fontSize="small" />, disabled: true },
  { key: 'settings', icon: <SettingsIcon fontSize="small" />, disabled: true },
];

export function AppShell() {
  const { t } = useTranslation();
  const { user, hotel, logout } = useAuth();
  const { data: bootstrap } = useBootstrap();

  const hotelName = bootstrap?.hotel?.name ?? hotel?.name ?? t('app.title');

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
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
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
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
        <List sx={{ px: 1.5, py: 2 }} data-testid="main-nav">
          {NAV_ENTRIES.map((entry) => {
            const label = t(`nav.${entry.key}`);
            const content = (
              <>
                <ListItemIcon sx={{ minWidth: 36 }}>{entry.icon}</ListItemIcon>
                <ListItemText
                  primary={label}
                  secondary={entry.disabled ? t('nav.soon') : undefined}
                  primaryTypographyProps={{ variant: 'body2' }}
                  secondaryTypographyProps={{ variant: 'caption' }}
                />
              </>
            );

            if (entry.disabled || !entry.to) {
              return (
                <ListItemButton key={entry.key} disabled sx={{ borderRadius: 2, mb: 0.5 }}>
                  {content}
                </ListItemButton>
              );
            }

            return (
              <ListItemButton
                key={entry.key}
                component={NavLink}
                to={entry.to}
                data-testid={entry.testId ?? `nav-${entry.key}`}
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
                {content}
              </ListItemButton>
            );
          })}
        </List>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
