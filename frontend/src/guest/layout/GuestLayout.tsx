import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import {
  IconHome,
  IconRestaurant,
  IconOrders,
  IconChat,
  IconInfo,
  type AppIconComponent,
} from '@/icons';
import { fadeInSx } from '@/kit';
import { GuestLanguageMenu } from '../components/GuestLanguageMenu';
import { useGuestHome } from '../hooks/useGuestQueries';
import { useGuestSession } from '../session/GuestSessionProvider';

export const BOTTOM_NAV_HEIGHT = 60;

/**
 * The common product's navigation: Home / Menu / Orders / Chat / Info. It is not
 * food-specific — Menu is simply the `product` section when a hotel has one.
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

/**
 * Shell for every screen behind the entry page. No top navigation band: per the
 * design reference the storefront is a photo-first canvas. Section navigation
 * lives in the bottom bar; the quiet room / language / theme controls float over
 * the content (glass), so the hero owns the top of the screen.
 */
export function GuestLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { session, hotel, isReady, isBootstrapping } = useGuestSession();
  const home = useGuestHome();
  const unreadChat = home.data?.unread_chat ?? 0;

  const hotelName = hotel?.name ?? session?.hotel.name ?? '';

  useEffect(() => {
    if (hotelName) document.title = hotelName;
  }, [hotelName]);

  if (isBootstrapping) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', bgcolor: 'background.default' }}>
        <CircularProgress aria-label={t('guest.common.loading')} />
      </Box>
    );
  }

  if (!isReady) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  const activeTab = TABS.find((tab) => location.pathname.startsWith(tab.value))?.value ?? false;

  const navIcon = (tab: NavTab) =>
    tab.value === '/chat' ? (
      <Badge badgeContent={unreadChat} color="error" max={99} data-testid="guest-chat-unread">
        <tab.Icon size={22} />
      </Badge>
    ) : (
      <tab.Icon size={22} />
    );

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      {/* Floating glass controls — over the content, top-right. */}
      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        sx={(th) => ({
          position: 'fixed',
          top: `calc(10px + env(safe-area-inset-top, 0px))`,
          insetInlineEnd: 12,
          zIndex: th.zIndex.appBar + 2,
          borderRadius: 999,
          px: 0.5,
          bgcolor: alpha(th.palette.background.paper, 0.55),
          backdropFilter: 'blur(12px)',
          border: `1px solid ${th.palette.divider}`,
          boxShadow: `0 8px 24px -14px ${alpha('#000', 0.6)}`,
        })}
      >
        {session?.room ? <RoomChip room={session.room} /> : null}
        <GuestLanguageMenu />
        <ThemeModeToggle />
      </Stack>

      <Box component="main" sx={{ flexGrow: 1, pb: `${BOTTOM_NAV_HEIGHT}px` }}>
        <Box key={location.pathname} sx={fadeInSx()}>
          <Outlet />
        </Box>
      </Box>

      {/* Bottom section nav — on every viewport (reference `.mnav`). */}
      <Paper
        square
        elevation={0}
        sx={(th) => ({
          position: 'fixed',
          insetInline: 0,
          bottom: 0,
          zIndex: th.zIndex.appBar + 1,
          borderTop: 1,
          borderColor: 'divider',
          pb: 'env(safe-area-inset-bottom, 0px)',
          bgcolor: alpha(th.palette.background.paper, 0.94),
          backdropFilter: 'blur(10px)',
        })}
      >
        <BottomNavigation
          showLabels
          value={activeTab}
          onChange={(_event, value: string) => navigate(value)}
          sx={{ height: BOTTOM_NAV_HEIGHT, bgcolor: 'transparent', maxWidth: 720, mx: 'auto' }}
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
    </Box>
  );
}

/**
 * Quiet room indicator (reference `.roomfloat`): an outlined pill with a small
 * accent dot and «Номер 305» — not a filled block.
 */
function RoomChip({ room }: { room: string }) {
  const { t } = useTranslation();
  return (
    <Box
      data-testid="guest-room-chip"
      sx={(th) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        height: 36,
        px: 1.25,
        borderRadius: 999,
        border: `1px solid ${th.palette.divider}`,
        color: 'text.primary',
        fontSize: 12.5,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      })}
    >
      <Box
        aria-hidden
        sx={(th) => ({
          width: 6,
          height: 6,
          borderRadius: '50%',
          bgcolor: 'primary.main',
          boxShadow: `0 0 0 3px ${alpha(th.palette.primary.main, 0.25)}`,
        })}
      />
      <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1 }}>
        {t('guest.common.roomShort', { room })}
      </Typography>
    </Box>
  );
}
