import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { alpha } from '@mui/material/styles';
import { keyframes } from '@mui/system';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { useAppTheme } from '@/theme';
import { pickLogo } from '@/theme/tokens';
import { resolveBackground } from '@/theme/brandBackground';
import { GuestLanguageMenu } from '../components/GuestLanguageMenu';
import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { fetchPublicHotel } from '../api/guest';
import { errorMessage } from '../errors';
import { useGuestSession } from '../session/GuestSessionProvider';
import type { GuestHotel } from '../api/types';

const ONEST = '"Onest", system-ui, sans-serif';

const kenBurns = keyframes`
  from { transform: scale(1.06) translate(0, 0); }
  to   { transform: scale(1.16) translate(1.5%, -1.2%); }
`;

function greetingKey(): string {
  const h = new Date().getHours();
  if (h < 5) return 'auth.greetings.night';
  if (h < 12) return 'auth.greetings.morning';
  if (h < 18) return 'auth.greetings.afternoon';
  return 'auth.greetings.evening';
}

/** Vector diamond monogram — fallback when the hotel has no logo token. */
function Monogram() {
  return (
    <Box component="svg" viewBox="0 0 40 40" width={26} height={26} aria-hidden sx={{ color: 'inherit' }}>
      <path d="M20 3.5 L34.5 16 L20 36.5 L5.5 16 Z" fill="none" stroke="currentColor" strokeWidth={1.4} />
      <path d="M5.5 16 H34.5 M20 3.5 V36.5" fill="none" stroke="currentColor" strokeWidth={0.8} opacity={0.5} />
    </Box>
  );
}

/**
 * Entry screen (`/`) and QR deep link (`/r/:roomNumber`) — reference variant A
 * «Полотно»: a full-screen atmospheric canvas themed by the hotel brand loaded
 * publicly by subdomain BEFORE login, so the screen is dark and white-labelled
 * from first paint, not after a session.
 */
export function EntryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { roomNumber: deepLinkRoom } = useParams<{ roomNumber: string }>();
  const { hotel, isReady, isBootstrapping, start } = useGuestSession();
  const { tokens, mode, setBrandTokens } = useAppTheme();

  const [publicHotel, setPublicHotel] = useState<GuestHotel | null>(null);
  const [room, setRoom] = useState(deepLinkRoom ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const deepLinkTried = useRef(false);

  // Load the brand publicly by subdomain so the entry themes before any session.
  useEffect(() => {
    let alive = true;
    void fetchPublicHotel()
      .then((h) => {
        if (!alive) return;
        setPublicHotel(h);
        if (h.theme) setBrandTokens(h.theme);
      })
      .catch(() => {
        /* unknown subdomain / offline — fall back to platform tokens */
      });
    return () => {
      alive = false;
    };
  }, [setBrandTokens]);

  const submit = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await start(value);
      navigate('/home', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'room_not_found') {
        setError(t('guest.entry.roomNotFound', { room: value ?? '' }));
      } else {
        setError(errorMessage(caught, t));
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!deepLinkRoom || deepLinkTried.current || isReady || isBootstrapping) return;
    deepLinkTried.current = true;
    void submit(deepLinkRoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkRoom, isReady, isBootstrapping]);

  if (isReady) return <Navigate to="/home" replace />;

  if (isBootstrapping || (deepLinkRoom && busy)) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', bgcolor: 'background.default' }}>
        <Stack spacing={2} alignItems="center">
          <CircularProgress aria-label={t('guest.common.loading')} />
          <Typography variant="body2" color="text.secondary">
            {t('guest.entry.connecting')}
          </Typography>
        </Stack>
      </Box>
    );
  }

  const canSubmit = room.trim().length > 0 && !busy;
  const shownHotel = publicHotel ?? hotel;
  const hotelName = shownHotel?.name ?? '';
  const logoSrc = pickLogo(tokens, mode);
  const backdrop = resolveBackground(tokens, mode);

  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '100dvh',
        overflow: 'hidden',
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Atmospheric backdrop: brand photo/gradient, slow Ken Burns drift. */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: '-4%',
          ...backdrop.css,
          animation: `${kenBurns} 32s ease-in-out infinite alternate`,
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      />
      {backdrop.dim > 0 ? (
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, bgcolor: `rgba(0,0,0,${backdrop.dim})` }} />
      ) : null}
      {/* Scrim: radial glow + darker edges so text and controls read. */}
      <Box
        aria-hidden
        sx={(th) => ({
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(120% 90% at 50% 8%, ${alpha(th.palette.primary.main, 0.18)}, transparent 60%), linear-gradient(180deg, ${alpha('#000', 0.45)} 0%, ${alpha('#000', 0.15)} 40%, ${alpha('#000', 0.62)} 100%)`,
        })}
      />

      {/* Logo top-left (brand token or monogram fallback). */}
      <Box
        sx={{
          position: 'absolute',
          top: `calc(18px + env(safe-area-inset-top, 0px))`,
          insetInlineStart: 22,
          zIndex: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          color: 'common.white',
        }}
      >
        {logoSrc ? (
          <Box component="img" src={logoSrc} alt={hotelName} data-testid="guest-brand-logo" sx={{ height: 30, maxWidth: 200, objectFit: 'contain' }} />
        ) : (
          <>
            <Monogram />
            {hotelName ? (
              <Typography
                component="span"
                sx={{ fontFamily: ONEST, fontSize: 14, fontWeight: 600, letterSpacing: '0.08em' }}
              >
                {hotelName}
              </Typography>
            ) : null}
          </>
        )}
      </Box>

      {/* Glass language + theme pills top-right. */}
      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        sx={(th) => ({
          position: 'absolute',
          top: `calc(14px + env(safe-area-inset-top, 0px))`,
          insetInlineEnd: 14,
          zIndex: 3,
          borderRadius: 999,
          px: 0.5,
          bgcolor: alpha(th.palette.common.black, 0.32),
          backdropFilter: 'blur(12px)',
          border: `1px solid ${alpha(th.palette.common.white, 0.18)}`,
          color: 'common.white',
        })}
      >
        <GuestLanguageMenu />
        <ThemeModeToggle />
      </Stack>

      {/* Centered content. */}
      <Box sx={{ position: 'relative', zIndex: 2, flexGrow: 1, display: 'flex', alignItems: 'center', px: 3 }}>
        <Box sx={{ width: '100%', maxWidth: 460, mx: 'auto' }}>
          <Typography
            component="h1"
            sx={{
              // Onest display per the acceptance mock — deliberately the same on
              // every brand, so the entry canvas reads consistently regardless of
              // a brand's serif heading font.
              fontFamily: ONEST,
              color: 'common.white',
              fontWeight: 800,
              letterSpacing: '-0.035em',
              fontSize: { xs: 40, md: 52 },
              lineHeight: 0.98,
              textShadow: '0 4px 30px rgba(0,0,0,0.55)',
            }}
          >
            {t(greetingKey())}
          </Typography>
          <Typography sx={{ color: alpha('#fff', 0.82), mt: 1, fontSize: 15 }}>
            {t('guest.entry.subtitle')}
          </Typography>

          {error ? (
            <Alert severity="warning" data-testid="guest-entry-error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          ) : null}

          <Box
            component="form"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) void submit(room.trim());
            }}
            sx={{ mt: 4 }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                borderBottom: `1px solid ${alpha('#fff', 0.3)}`,
                pb: 1,
                transition: 'border-color .25s',
                '&:focus-within': { borderColor: alpha('#fff', 0.7) },
              }}
            >
              <InputBase
                autoFocus
                fullWidth
                value={room}
                onChange={(event) => setRoom(event.target.value)}
                placeholder={t('guest.entry.roomPlaceholder')}
                inputProps={{
                  inputMode: 'numeric',
                  autoComplete: 'off',
                  'data-testid': 'guest-room-input',
                  'aria-label': t('guest.entry.roomLabel'),
                }}
                sx={{
                  // Placeholder colour comes from MUI's compiled InputBase styles
                  // (input colour at reduced opacity) — never style ::placeholder
                  // in runtime sx: it crashes the stylis prefixer.
                  color: 'common.white',
                  fontSize: 19,
                  fontWeight: 500,
                }}
              />
              <IconButton
                type="submit"
                disabled={!canSubmit}
                data-testid="guest-room-submit"
                aria-label={t('guest.entry.submit')}
                sx={(th) => ({
                  width: 46,
                  height: 46,
                  flex: 'none',
                  color: 'common.white',
                  border: `1.5px solid ${alpha('#fff', 0.55)}`,
                  transition: 'background-color .18s, transform .12s',
                  '&:hover': { bgcolor: th.palette.primary.main, borderColor: th.palette.primary.main, transform: 'translateX(2px)' },
                  '&.Mui-disabled': { color: alpha('#fff', 0.35), borderColor: alpha('#fff', 0.2) },
                })}
              >
                <ArrowForwardIcon />
              </IconButton>
            </Box>

            <Box
              data-testid="guest-scan-qr"
              title={t('guest.entry.qrHint')}
              sx={{ mt: 2.5, display: 'flex', alignItems: 'center', gap: 1.25, color: alpha('#fff', 0.42), fontSize: 12.5 }}
            >
              <Box aria-hidden sx={{ width: 26, height: '1px', bgcolor: alpha('#fff', 0.28), flex: 'none' }} />
              {t('guest.entry.qrShort')}
            </Box>

            <Button
              variant="text"
              disabled={busy}
              onClick={() => void submit(null)}
              data-testid="guest-browse-only"
              sx={{ mt: 3, color: alpha('#fff', 0.8), minHeight: 44, px: 0 }}
            >
              {t('guest.entry.browseOnly')}
            </Button>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
