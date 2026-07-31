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
import useMediaQuery from '@mui/material/useMediaQuery';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { useAppTheme } from '@/theme';
import { pickLogo } from '@/theme/tokens';
import {
  IconHome,
  IconOrders,
  IconChat,
  IconInfo,
  type AppIconComponent,
} from '@/icons';
import { fadeInSx } from '@/kit';
import { GuestLanguageMenu } from '../components/GuestLanguageMenu';
import { useGuestHome } from '../hooks/useGuestQueries';
import { useGuestSession } from '../session/GuestSessionProvider';
import { useCart } from '../state/cart';
import { CartPage } from '../pages/CartPage';
import { GuestTopBar } from './GuestTopBar';
import { layout as storefrontLayout } from '../storefrontTokens';
import { BOTTOM_NAV_HEIGHT, CART_WIDTH, CONTENT_MAX, DESKTOP_QUERY } from './constants';

export { BOTTOM_NAV_HEIGHT, DESKTOP_QUERY } from './constants';

interface NavTab {
  value: string;
  Icon: AppIconComponent;
  labelKey: string;
}

// Same roles as the bottom nav — one testid per role, whatever the viewport,
// so E2E scenarios don't fork by width. Grouped for the rail («Отель»).
// «Меню» больше не раздел: плоского каталога отеля не существует, меню живёт
// внутри заведения и открывается его плиткой на главной.
const PRIMARY_TABS: NavTab[] = [
  { value: '/home', Icon: IconHome, labelKey: 'guest.nav.home' },
  { value: '/orders', Icon: IconOrders, labelKey: 'guest.nav.orders' },
];
const HOTEL_TABS: NavTab[] = [
  { value: '/chat', Icon: IconChat, labelKey: 'guest.nav.chat' },
  { value: '/info', Icon: IconInfo, labelKey: 'guest.nav.info' },
];
const TABS = [...PRIMARY_TABS, ...HOTEL_TABS];
const TOP_BAR_HEIGHT = storefrontLayout.topBar;

/**
 * Один шелл на все экраны витрины, адаптивный по ширине.
 *
 * Общая логика (сессия, счётчик непрочитанного, активный раздел) считается
 * один раз; различается только обвязка: до 1024 — нижнее стеклянное меню и
 * плавающие чипы, от 1024 — ВЕРХНЯЯ стеклянная строка (R5; левый рельс убран:
 * он съедал ширину на экране, где ценность — кадры заведений во всю ширину).
 * Корзина — колонка справа на десктопе и отдельный экран на телефоне.
 */
export function GuestLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { session, hotel, isReady, isBootstrapping } = useGuestSession();
  const { tokens, mode } = useAppTheme();
  const home = useGuestHome();
  const unreadChat = home.data?.unread_chat ?? 0;
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

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
  const badgeFor = (value: string) => (value === '/chat' ? unreadChat : 0);
  const room = session?.room ?? null;
  // Cart lives as a right column on desktop, visible only with a non-empty order.
  const cart = useCart();
  const cartOpen = isDesktop && !cart.isEmpty;
  const content = (
    <Box key={location.pathname} sx={fadeInSx()}>
      <Outlet />
    </Box>
  );

  // ── Планшет и десктоп: верхняя стеклянная строка, контент, корзина колонкой ──
  if (isDesktop) {
    return (
      <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
        <GuestTopBar
          hotelName={hotelName}
          logo={pickLogo(tokens, mode) ?? null}
          tabs={TABS.map((tab) => ({ value: tab.value, labelKey: tab.labelKey }))}
          active={activeTab}
          room={room}
          cartCount={cart.count}
          unreadChat={unreadChat}
          onNavigate={navigate}
          onOpenCart={() => navigate('/cart')}
        />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: cartOpen
              ? `minmax(0, ${CONTENT_MAX}px) ${CART_WIDTH}px`
              : `minmax(0, ${CONTENT_MAX}px)`,
            justifyContent: 'center',
            minHeight: `calc(100dvh - ${TOP_BAR_HEIGHT}px)`,
          }}
        >
          <Box component="main" sx={{ minWidth: 0 }}>
            {content}
          </Box>
          {cartOpen ? <CartPage variant="column" /> : null}
        </Box>
      </Box>
    );
  }

  // ── Phone / tablet: floating controls + bottom bar (unchanged behaviour) ──
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
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
        {room ? <RoomChip room={room} /> : null}
        <GuestLanguageMenu />
        <ThemeModeToggle />
      </Stack>

      <Box component="main" sx={{ flexGrow: 1, pb: `${BOTTOM_NAV_HEIGHT}px` }}>
        {content}
      </Box>

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
              icon={
                badgeFor(tab.value) ? (
                  <Badge badgeContent={unreadChat} color="error" max={99} data-testid="guest-chat-unread">
                    <tab.Icon size={22} />
                  </Badge>
                ) : (
                  <tab.Icon size={22} />
                )
              }
              sx={{ minWidth: 44 }}
            />
          ))}
        </BottomNavigation>
      </Paper>
    </Box>
  );
}

/** Rail header: brand logo (or vector monogram) + hotel wordmark. */
function RoomChip({ room }: { room: string }) {
  const { t } = useTranslation();
  return (
    <Box
      data-testid="guest-room-chip"
      sx={(th) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        alignSelf: 'flex-start',
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
