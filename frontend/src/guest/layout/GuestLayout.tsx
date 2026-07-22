import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { pickLogo } from '@/theme/tokens';
import { useAppTheme } from '@/theme';
import {
  IconHome,
  IconRestaurant,
  IconOrders,
  IconChat,
  IconInfo,
  type AppIconComponent,
} from '@/icons';
import { fadeInSx, pressableSx } from '@/kit';
import { GuestBrandHeader } from '../components/GuestBrandHeader';
import { GuestLanguageMenu } from '../components/GuestLanguageMenu';
import { useGuestHome } from '../hooks/useGuestQueries';
import { useGuestSession } from '../session/GuestSessionProvider';

export const BOTTOM_NAV_HEIGHT = 60;

/**
 * The common product's navigation: Home / Menu / Orders / Chat / Info. It is not
 * food-specific — Menu is simply the `product` section when a hotel has one, and
 * both Info and the slot/service catalogs are reachable from the Home tiles too.
 */
interface NavTab {
  value: string;
  Icon: AppIconComponent;
  labelKey: string;
}

const TABS: NavTab[] = [
  { value: '/home', Icon: IconHome, labelKey: 'guest.nav.home' },
  { value: '/menu', Icon: IconRestaurant, labelKey: 'guest.nav.menu' },
  { value: '/orders', Icon: IconOrders, labelKey: 'guest.nav.orders' },
  { value: '/chat', Icon: IconChat, labelKey: 'guest.nav.chat' },
  { value: '/info', Icon: IconInfo, labelKey: 'guest.nav.info' },
];

/** Shell for every screen behind the entry page. */
export function GuestLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const { session, hotel, isReady, isBootstrapping } = useGuestSession();
  const home = useGuestHome();
  const unreadChat = home.data?.unread_chat ?? 0;
  const { tokens, mode } = useAppTheme();
  const logoSrc = pickLogo(tokens, mode);

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

  const activeTab = TABS.find((tab) => location.pathname.startsWith(tab.value))?.value ?? false;

  const controls = (
    <>
      {session?.room ? (
        <Chip
          size="small"
          label={t('guest.common.roomShort', { room: session.room })}
          data-testid="guest-room-chip"
        />
      ) : null}
      <GuestLanguageMenu />
      <ThemeModeToggle />
    </>
  );

  const navIcon = (tab: NavTab) =>
    tab.value === '/chat' ? (
      <Badge badgeContent={unreadChat} color="error" max={99} data-testid="guest-chat-unread">
        <tab.Icon size={22} />
      </Badge>
    ) : (
      <tab.Icon size={22} />
    );

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {isDesktop ? (
        /* ── Desktop: full-width top navigation replaces the bottom bar ──── */
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
          <Toolbar sx={{ gap: 2, minHeight: 68, px: { md: 3, lg: 5 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
              {logoSrc ? (
                <Box
                  component="img"
                  src={logoSrc}
                  alt={hotelName}
                  data-testid="guest-brand-logo"
                  sx={{ height: 34, maxWidth: 200, objectFit: 'contain' }}
                />
              ) : (
                <Typography
                  variant="h6"
                  noWrap
                  sx={(t2) => ({ fontFamily: t2.typography.h1.fontFamily })}
                >
                  {hotelName}
                </Typography>
              )}
            </Box>

            <Stack
              direction="row"
              spacing={0.5}
              component="nav"
              sx={{ flexGrow: 1, justifyContent: 'center' }}
            >
              {TABS.map((tab) => {
                const active = activeTab === tab.value;
                return (
                  <ButtonBase
                    key={tab.value}
                    onClick={() => navigate(tab.value)}
                    data-testid={`guest-nav-${tab.value.slice(1)}`}
                    aria-current={active ? 'page' : undefined}
                    sx={[
                      (t2) => ({
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        minHeight: 44,
                        px: 2,
                        borderRadius: `${t2.palette.brand.radius.pill}px`,
                        color: active ? 'primary.main' : 'text.secondary',
                        bgcolor: active ? t2.palette.brand.primarySoft : 'transparent',
                        fontWeight: active
                          ? t2.typography.fontWeightBold
                          : t2.typography.fontWeightMedium,
                        '&:hover': { bgcolor: t2.palette.brand.surfaceHover },
                        '&.Mui-focusVisible': {
                          outline: `2px solid ${t2.palette.primary.main}`,
                          outlineOffset: 2,
                        },
                      }),
                      pressableSx,
                    ]}
                  >
                    {navIcon(tab)}
                    <Box component="span" sx={{ fontSize: 15 }}>
                      {t(tab.labelKey)}
                    </Box>
                  </ButtonBase>
                );
              })}
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center">
              {controls}
            </Stack>
          </Toolbar>
        </AppBar>
      ) : (
        <GuestBrandHeader hotelName={hotelName} logoSrc={logoSrc} rightSlot={controls} />
      )}

      <Box
        component="main"
        sx={{ flexGrow: 1, pb: isDesktop ? 0 : `${BOTTOM_NAV_HEIGHT}px` }}
      >
        {/* Screen transition: content fades in on each route change. */}
        <Box key={location.pathname} sx={fadeInSx()}>
          <Outlet />
        </Box>
      </Box>

      {isDesktop ? null : (
        <>
          <Paper
            square
            elevation={0}
            sx={{
              position: 'fixed',
              insetInline: 0,
              bottom: 0,
              zIndex: (t2) => t2.zIndex.appBar + 1,
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
                  icon={navIcon(tab)}
                  sx={{ minWidth: 44 }}
                />
              ))}
            </BottomNavigation>
          </Paper>

          <Stack sx={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
        </>
      )}
    </Box>
  );
}
