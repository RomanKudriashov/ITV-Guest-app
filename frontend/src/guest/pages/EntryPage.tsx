import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { GuestLanguageMenu } from '../components/GuestLanguageMenu';
import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { errorMessage } from '../errors';
import { useGuestSession } from '../session/GuestSessionProvider';

/**
 * Entry screen (`/`) and QR deep link (`/r/:roomNumber`).
 *
 * The deep link creates the session immediately; an unknown room falls back to
 * manual entry with the hotel brand already on screen (the 404 carries it).
 */
export function EntryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { roomNumber: deepLinkRoom } = useParams<{ roomNumber: string }>();
  const { hotel, isReady, isBootstrapping, start } = useGuestSession();

  const [room, setRoom] = useState(deepLinkRoom ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrHintOpen, setQrHintOpen] = useState(false);
  const deepLinkTried = useRef(false);

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

  // Deep link: create the session without waiting for a tap.
  useEffect(() => {
    if (!deepLinkRoom || deepLinkTried.current || isReady || isBootstrapping) return;
    deepLinkTried.current = true;
    void submit(deepLinkRoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkRoom, isReady, isBootstrapping]);

  if (isReady) return <Navigate to="/home" replace />;

  if (isBootstrapping || (deepLinkRoom && busy)) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
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

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
        pt: 'env(safe-area-inset-top, 0px)',
        pb: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <Stack direction="row" justifyContent="flex-end" sx={{ p: 1 }}>
        <GuestLanguageMenu />
        <ThemeModeToggle />
      </Stack>

      <Container maxWidth="sm" sx={{ flexGrow: 1, display: 'flex', alignItems: 'center' }}>
        <Stack spacing={4} sx={{ width: '100%', py: 4 }}>
          {/* Brand splash — colors come from the hotel theme via tokens. */}
          <Stack spacing={1.5} alignItems="center" textAlign="center">
            <Box
              aria-hidden
              sx={(theme) => ({
                width: 96,
                height: 96,
                borderRadius: `${theme.palette.brand.radius.lg}px`,
                display: 'grid',
                placeItems: 'center',
                color: 'primary.contrastText',
                // Depth, not a flat fill: an accent gradient with the accent glow.
                backgroundImage: `linear-gradient(150deg, ${theme.palette.brand.primaryStrong}, ${theme.palette.primary.main})`,
                boxShadow: theme.palette.brand.elevation.glow,
                fontFamily: theme.typography.h1.fontFamily,
                fontSize: 40,
                fontWeight: theme.typography.fontWeightBold,
              })}
            >
              {(hotel?.name ?? 'ITV').trim().charAt(0).toUpperCase()}
            </Box>
            <Typography variant="h4" component="h1">
              {hotel?.name ?? t('app.title')}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {t('guest.entry.subtitle')}
            </Typography>
          </Stack>

          {error ? (
            <Alert severity="warning" data-testid="guest-entry-error">
              {error}
            </Alert>
          ) : null}

          <Stack
            component="form"
            spacing={2}
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) void submit(room.trim());
            }}
          >
            <TextField
              autoFocus
              fullWidth
              label={t('guest.entry.roomLabel')}
              placeholder={t('guest.entry.roomPlaceholder')}
              value={room}
              onChange={(event) => setRoom(event.target.value)}
              inputProps={{
                inputMode: 'numeric',
                autoComplete: 'off',
                'data-testid': 'guest-room-input',
                'aria-label': t('guest.entry.roomLabel'),
              }}
              helperText={t('guest.entry.roomHelper')}
            />
            <Button
              type="submit"
              size="large"
              variant="contained"
              disabled={!canSubmit}
              data-testid="guest-room-submit"
              sx={{ minHeight: 52 }}
            >
              {busy ? t('guest.entry.connecting') : t('guest.entry.submit')}
            </Button>
            <Button
              size="large"
              variant="outlined"
              startIcon={<QrCodeScannerIcon />}
              onClick={() => setQrHintOpen((prev) => !prev)}
              data-testid="guest-scan-qr"
              sx={{ minHeight: 52 }}
            >
              {t('guest.entry.scanQr')}
            </Button>
            {qrHintOpen ? (
              <Alert severity="info">{t('guest.entry.qrHint')}</Alert>
            ) : null}
          </Stack>

          <Divider flexItem>
            <Typography variant="caption" color="text.secondary">
              {t('guest.entry.or')}
            </Typography>
          </Divider>

          <Button
            variant="text"
            disabled={busy}
            onClick={() => void submit(null)}
            data-testid="guest-browse-only"
            sx={{ minHeight: 44 }}
          >
            {t('guest.entry.browseOnly')}
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}
