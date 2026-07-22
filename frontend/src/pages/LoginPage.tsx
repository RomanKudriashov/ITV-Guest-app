import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha, type Theme } from '@mui/material/styles';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';

import { ApiError } from '@/api/client';
import { useAuth } from '@/auth';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { AuthAtmosphere } from '@/kit/AuthAtmosphere';
import { KitButton } from '@/kit/buttons';
import { KitTextField } from '@/kit/forms';

/**
 * Staggered mount reveal. Each element fades/rises into place a beat after the
 * previous one. Under `prefers-reduced-motion: reduce` the animation is dropped
 * entirely and the final resting state is shown immediately.
 */
const reveal = (order: number) => (theme: Theme) => ({
  '@keyframes authReveal': {
    from: { opacity: 0, transform: 'translateY(14px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
  opacity: 0,
  animation: `authReveal 0.6s ${theme.transitions.easing.easeOut} both`,
  animationDelay: `${order * 130}ms`,
  '@media (prefers-reduced-motion: reduce)': {
    animation: 'none',
    animationDelay: '0ms',
    opacity: 1,
    transform: 'none',
  },
});

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/cms/menu';

  if (isAuthenticated) return <Navigate to={from} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (loginError) {
      const message =
        loginError instanceof ApiError ? loginError.detail : t('auth.networkError');
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '100vh',
        bgcolor: 'background.default',
        display: 'grid',
        placeItems: 'center',
        p: 3,
        overflow: 'hidden',
      }}
    >
      <AuthAtmosphere />

      <Stack
        spacing={2}
        sx={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420 }}
      >
        <Stack
          direction="row"
          justifyContent="flex-end"
          alignItems="center"
          spacing={1}
          sx={reveal(0)}
        >
          <LanguageSwitcher compact />
          <ThemeModeToggle />
        </Stack>

        <Card
          sx={(theme: Theme) => ({
            // Glass surface: translucent paper + blur + hairline border.
            backgroundColor: alpha(theme.palette.background.paper, 0.76),
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: theme.palette.brand.elevation.lg,
          })}
        >
          <CardContent sx={{ p: 4 }}>
            <Stack spacing={3} component="form" onSubmit={submit}>
              <Stack spacing={1.5} alignItems="center" sx={reveal(1)}>
                <Box
                  sx={(theme: Theme) => ({
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    boxShadow: theme.palette.brand.elevation.glow,
                  })}
                >
                  <RestaurantMenuIcon fontSize="medium" />
                </Box>
                <Typography
                  variant="h3"
                  textAlign="center"
                  sx={(theme: Theme) => ({
                    fontFamily: theme.typography.h1.fontFamily,
                    lineHeight: 1.15,
                  })}
                >
                  {t('auth.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" textAlign="center">
                  {t('auth.subtitle')}
                </Typography>
              </Stack>

              {error ? (
                <Alert severity="error" data-testid="login-error" sx={reveal(2)}>
                  {error}
                </Alert>
              ) : null}

              <Box sx={reveal(2)}>
                <KitTextField
                  label={t('auth.email')}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  autoFocus
                  inputProps={{ 'data-testid': 'login-email' }}
                  sx={{ '& .MuiOutlinedInput-root': { minHeight: 48 } }}
                />
              </Box>
              <Box sx={reveal(3)}>
                <KitTextField
                  label={t('auth.password')}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  inputProps={{ 'data-testid': 'login-password' }}
                  sx={{ '& .MuiOutlinedInput-root': { minHeight: 48 } }}
                />
              </Box>

              <KitButton
                type="submit"
                size="large"
                fullWidth
                loading={busy}
                disabled={!canSubmit}
                data-testid="login-submit"
                sx={reveal(4)}
              >
                {busy ? t('auth.signingIn') : t('auth.submit')}
              </KitButton>

              <Typography
                variant="caption"
                color="text.secondary"
                textAlign="center"
                sx={reveal(5)}
              >
                {t('auth.demoHint', {
                  email: 'chef@crystal.local',
                  password: 'chef12345',
                })}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}
