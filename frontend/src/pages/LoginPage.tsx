import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';

import { ApiError } from '@/api/client';
import { useAuth } from '@/auth';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeModeToggle } from '@/components/ThemeModeToggle';

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
        minHeight: '100vh',
        bgcolor: 'background.default',
        display: 'grid',
        placeItems: 'center',
        p: 3,
      }}
    >
      <Stack spacing={2} sx={{ width: '100%', maxWidth: 420 }}>
        <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={1}>
          <LanguageSwitcher compact />
          <ThemeModeToggle />
        </Stack>

        <Card variant="outlined" sx={{ borderColor: 'divider' }}>
          <CardContent sx={{ p: 4 }}>
            <Stack spacing={3} component="form" onSubmit={submit}>
              <Stack spacing={1} alignItems="center">
                <Box
                  sx={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                  }}
                >
                  <RestaurantMenuIcon />
                </Box>
                <Typography variant="h5">{t('auth.title')}</Typography>
                <Typography variant="body2" color="text.secondary" textAlign="center">
                  {t('auth.subtitle')}
                </Typography>
              </Stack>

              {error ? (
                <Alert severity="error" data-testid="login-error">
                  {error}
                </Alert>
              ) : null}

              <TextField
                label={t('auth.email')}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                autoFocus
                fullWidth
                inputProps={{ 'data-testid': 'login-email' }}
              />
              <TextField
                label={t('auth.password')}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                fullWidth
                inputProps={{ 'data-testid': 'login-password' }}
              />

              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={!canSubmit}
                data-testid="login-submit"
              >
                {busy ? t('auth.signingIn') : t('auth.submit')}
              </Button>

              <Typography variant="caption" color="text.secondary" textAlign="center">
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
