import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import { useTranslation } from 'react-i18next';

import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { GuestLanguageMenu } from '../components/GuestLanguageMenu';
import { useCart } from '../state/cart';
import { useGuestSession } from '../session/GuestSessionProvider';

export const BOTTOM_NAV_HEIGHT = 60;

const TABS = [
  { value: '/home', icon: <HomeOutlinedIcon />, labelKey: 'guest.nav.home' },
  { value: '/menu', icon: <RestaurantMenuIcon />, labelKey: 'guest.nav.menu' },
  { value: '/cart', icon: <ShoppingBagOutlinedIcon />, labelKey: 'guest.nav.cart' },
  { value: '/orders', icon: <ReceiptLongOutlinedIcon />, labelKey: 'guest.nav.orders' },
] as const;

/** Shell for every screen behind the entry page: brand header + bottom navigation. */
export function GuestLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { session, hotel, isReady, isBootstrapping } = useGuestSession();
  const { count } = useCart();

  const hotelName = hotel?.name ?? session?.hotel.name ?? '';

  useEffect(() => {
    if (hotelName) document.title = hotelName;
  }, [hotelName]);

  if (isBootstrapping) {
    return (
      <Box
        sx={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'background.default',
        }}
      >
        <CircularProgress aria-label={t('guest.common.loading')} />
      </Box>
    );
  }

  if (!isReady) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  const activeTab =
    TABS.find((tab) => location.pathname.startsWith(tab.value))?.value ?? false;

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <AppBar
        position="sticky"
        color="default"
        elevation={0}
        sx={{
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          pt: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <Toolbar sx={{ gap: 1, minHeight: 56 }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
              {hotelName}
            </Typography>
          </Box>
          {session?.room ? (
            <Chip
              size="small"
              label={t('guest.common.roomShort', { room: session.room })}
              data-testid="guest-room-chip"
            />
          ) : null}
          <GuestLanguageMenu />
          <ThemeModeToggle />
        </Toolbar>
      </AppBar>

      <Box component="main" sx={{ flexGrow: 1, pb: `${BOTTOM_NAV_HEIGHT}px` }}>
        <Outlet />
      </Box>

      <Paper
        square
        elevation={0}
        sx={{
          position: 'fixed',
          insetInline: 0,
          bottom: 0,
          zIndex: (theme) => theme.zIndex.appBar + 1,
          borderTop: 1,
          borderColor: 'divider',
          pb: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <BottomNavigation
          showLabels
          value={activeTab}
          onChange={(_event, value: string) => navigate(value)}
          sx={{ height: BOTTOM_NAV_HEIGHT, bgcolor: 'background.paper' }}
        >
          {TABS.map((tab) => (
            <BottomNavigationAction
              key={tab.value}
              value={tab.value}
              label={t(tab.labelKey)}
              data-testid={`guest-nav-${tab.value.slice(1)}`}
              icon={
                tab.value === '/cart' ? (
                  <Badge badgeContent={count} color="primary" max={99}>
                    {tab.icon}
                  </Badge>
                ) : (
                  tab.icon
                )
              }
              sx={{ minWidth: 44 }}
            />
          ))}
        </BottomNavigation>
      </Paper>

      <Stack sx={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
    </Box>
  );
}
