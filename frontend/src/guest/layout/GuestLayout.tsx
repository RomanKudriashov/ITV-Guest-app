import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import ButtonBase from '@mui/material/ButtonBase';
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
/** Desktop starts at 1024 (spec §4); below it the rail would eat the content. */
export const DESKTOP_QUERY = '(min-width:1024px)';
/** Rail + content are capped so the storefront never stretches indefinitely. */
const RAIL_WIDTH = 236;
const CONTENT_MAX = 1080;

interface NavTab {
  value: string;
  Icon: AppIconComponent;
  labelKey: string;
}

// Same roles as the bottom nav — one testid per role, whatever the viewport,
// so E2E scenarios don't fork by width. Grouped for the rail («Отель»).
const PRIMARY_TABS: NavTab[] = [
  { value: '/home', Icon: IconHome, labelKey: 'guest.nav.home' },
  { value: '/menu', Icon: IconRestaurant, labelKey: 'guest.nav.menu' },
  { value: '/orders', Icon: IconOrders, labelKey: 'guest.nav.orders' },
];
const HOTEL_TABS: NavTab[] = [
  { value: '/chat', Icon: IconChat, labelKey: 'guest.nav.chat' },
  { value: '/info', Icon: IconInfo, labelKey: 'guest.nav.info' },
];
const TABS = [...PRIMARY_TABS, ...HOTEL_TABS];

/**
 * ONE shell for every storefront screen, adaptive by width (spec §4). The shared
 * business logic (session, unread badge, active tab) is computed once; only the
 * chrome differs: below 1024 a bottom bar with floating glass controls; at 1024+
 * a left rail with the room/language/theme at its foot and no bottom bar. The
 * cart lives as a right column on desktop and as its own screen on mobile.
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
  const content = (
    <Box key={location.pathname} sx={fadeInSx()}>
      <Outlet />
    </Box>
  );

  // ── Desktop: left rail + capped content (+ cart column, added next step) ──
  if (isDesktop) {
    return (
      <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: `${RAIL_WIDTH}px minmax(0, ${CONTENT_MAX}px)`,
            justifyContent: 'center',
            minHeight: '100dvh',
          }}
        >
          <Box
            component="aside"
            sx={(th) => ({
              position: 'sticky',
              top: 0,
              alignSelf: 'start',
              height: '100dvh',
              borderInlineEnd: `1px solid ${th.palette.divider}`,
              bgcolor: 'background.paper',
              px: 2.25,
              py: 3,
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
            })}
          >
            <RailBrand name={hotelName} logo={pickLogo(tokens, mode)} />
            <RailNav
              groups={[
                { tabs: PRIMARY_TABS },
                { label: t('guest.nav.hotelGroup'), tabs: HOTEL_TABS },
              ]}
              active={activeTab}
              badgeFor={badgeFor}
              onNavigate={navigate}
              t={t}
            />
            <Stack spacing={1.25} sx={{ mt: 'auto' }}>
              {room ? <RoomChip room={room} /> : null}
              <Stack direction="row" spacing={0.5} alignItems="center">
                <GuestLanguageMenu />
                <ThemeModeToggle />
              </Stack>
            </Stack>
          </Box>

          <Box component="main" sx={{ minWidth: 0 }}>
            {content}
          </Box>
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
function RailBrand({ name, logo }: { name: string; logo?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 0.75, color: 'text.primary' }}>
      {logo ? (
        <Box component="img" src={logo} alt={name} data-testid="guest-brand-logo" sx={{ height: 26, maxWidth: 180, objectFit: 'contain' }} />
      ) : (
        <>
          <Box component="svg" viewBox="0 0 40 40" width={26} height={26} aria-hidden sx={{ color: 'inherit', flex: 'none' }}>
            <path d="M20 3.5 L34.5 16 L20 36.5 L5.5 16 Z" fill="none" stroke="currentColor" strokeWidth={1.3} />
            <path d="M5.5 16 H34.5 M20 3.5 V36.5" fill="none" stroke="currentColor" strokeWidth={0.7} opacity={0.5} />
          </Box>
          <Typography
            component="span"
            noWrap
            sx={(th) => ({ fontFamily: th.typography.h1.fontFamily, fontSize: 13, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' })}
          >
            {name}
          </Typography>
        </>
      )}
    </Box>
  );
}

interface RailNavGroup {
  label?: string;
  tabs: NavTab[];
}

function RailNav({
  groups,
  active,
  badgeFor,
  onNavigate,
  t,
}: {
  groups: RailNavGroup[];
  active: string | false;
  badgeFor: (value: string) => number;
  onNavigate: (to: string) => void;
  t: (key: string) => string;
}) {
  return (
    <Box component="nav" sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      {groups.map((group, gi) => (
        <Box key={gi}>
          {group.label ? (
            <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'text.disabled', px: 1.5, pt: 2, pb: 0.75 }}>
              {group.label}
            </Typography>
          ) : null}
          {group.tabs.map((tab) => {
            const on = active === tab.value;
            const badge = badgeFor(tab.value);
            return (
              <ButtonBase
                key={tab.value}
                onClick={() => onNavigate(tab.value)}
                data-testid={`guest-nav-${tab.value.slice(1)}`}
                aria-current={on ? 'page' : undefined}
                sx={(th) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  justifyContent: 'flex-start',
                  width: '100%',
                  px: 1.5,
                  py: 1.25,
                  borderRadius: 2.5,
                  fontSize: 14,
                  fontWeight: 600,
                  color: on ? th.palette.primary.main : th.palette.text.secondary,
                  bgcolor: on ? alpha(th.palette.primary.main, 0.14) : 'transparent',
                  '&:hover': { bgcolor: on ? alpha(th.palette.primary.main, 0.18) : th.palette.action.hover, color: on ? th.palette.primary.main : th.palette.text.primary },
                })}
              >
                {badge ? (
                  <Badge badgeContent={badge} color="error" max={99} data-testid="guest-chat-unread">
                    <tab.Icon size={19} />
                  </Badge>
                ) : (
                  <tab.Icon size={19} />
                )}
                <Box component="span">{t(tab.labelKey)}</Box>
              </ButtonBase>
            );
          })}
        </Box>
      ))}
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
