import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { useAppTheme } from '@/theme';
import { adminCssVars, accent, ink, pageBackground, panelSx, primaryButtonSx } from './adminTokens';
import { platformLogin, PlatformError } from './adminClient';

/**
 * Вход в корневую админку.
 *
 * Второй фактор открывается ПО ОТВЕТУ СЕРВЕРА, а не по догадке клиента: знать
 * до проверки пароля, заведена ли у этого адреса 2FA, клиент не должен — иначе
 * форма входа сама рассказывала бы, какие учётки защищены слабее.
 */
export function AdminLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useTranslation();
  const { mode } = useAppTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await platformLogin(email.trim(), password, needsCode ? code.trim() : undefined);
      onLoggedIn();
    } catch (e) {
      if (e instanceof PlatformError && e.code === 'mfa_required') {
        setNeedsCode(true);
      } else {
        setError(e instanceof PlatformError ? e.message : t('admin.login.failed'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        p: 2,
        ...adminCssVars(mode),
        background: pageBackground,
      }}
    >
      <Box sx={{ ...panelSx, width: 380, maxWidth: '100%', p: 3 }} data-testid="admin-login">
        <Stack spacing={2}>
          <Box>
            <Typography sx={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: accent.soft, fontWeight: 700 }}>
              {t('admin.brand.name')}
            </Typography>
            <Typography sx={{ fontSize: 19, fontWeight: 800, color: ink.hi, mt: 0.5 }}>
              {t('admin.login.title')}
            </Typography>
          </Box>
          {error ? <Alert severity="error" data-testid="admin-login-error">{error}</Alert> : null}
          <TextField
            label={t('admin.login.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            inputProps={{ 'data-testid': 'admin-login-email' }}
          />
          <TextField
            label={t('admin.login.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            inputProps={{ 'data-testid': 'admin-login-password' }}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
          {needsCode ? (
            <TextField
              label={t('admin.login.code')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              autoComplete="one-time-code"
              helperText={t('admin.login.codeHint')}
              inputProps={{ 'data-testid': 'admin-login-totp', inputMode: 'numeric', maxLength: 6 }}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            />
          ) : null}
          <Button
            variant="contained"
            disabled={busy || !email || !password || (needsCode && code.length < 6)}
            onClick={() => void submit()}
            data-testid="admin-login-submit"
            sx={primaryButtonSx}
          >
            {needsCode ? t('admin.login.confirm') : t('admin.login.submit')}
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
