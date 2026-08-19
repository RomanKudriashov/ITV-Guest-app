import { useState, type FormEvent } from 'react';
import Box from '@mui/material/Box';
import InputBase from '@mui/material/InputBase';
import { useTranslation } from 'react-i18next';

import { AuthAtmosphere } from '@/kit/AuthAtmosphere';
import {
  AuthBrand,
  AuthError,
  AuthHint,
  AuthPanel,
  AuthSubmitButton,
  AuthTitle,
  AuthTopControls,
  GlassPill,
  MoonGlyph,
  SunGlyph,
  inputSx,
  lineRowSx,
} from '@/kit/auth';
import { revealSx } from '@/kit/motion';
import { useAppTheme } from '@/theme';
import { platformLogin, platformSession, PlatformError } from './adminClient';

/**
 * Вход в консоль платформы.
 *
 * Второй фактор открывается ПО ОТВЕТУ СЕРВЕРА, а не по догадке клиента: знать
 * до проверки пароля, заведена ли у этого адреса 2FA, клиент не должен — иначе
 * форма входа сама рассказывала бы, какие учётки защищены слабее.
 *
 * ВНЕШНОСТЬ — ТА ЖЕ, ЧТО У ВХОДА В CMS, и буквально тот же код (`kit/auth`).
 * Была светлая карточка 380px по центру серого поля: поля MUI по умолчанию,
 * заливная кнопка, ничего общего с дверью, через которую входят в тот же
 * продукт этажом ниже. Отличается ровно то, что и должно отличаться, —
 * подпись под маркой: «Root · admin».
 */
export function AdminLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useTranslation();
  const { mode, direction, toggleMode } = useAppTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  // Тот же повод, что и в CMS: сессия, кончившаяся посреди работы, называет
  // себя, а не возвращает молча к форме.
  const [error, setError] = useState<string | null>(
    platformSession.hasExpired() ? t('auth.sessionExpired') : null,
  );
  const [busy, setBusy] = useState(false);
  const rtl = direction === 'rtl';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
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

  const canSubmit =
    email.trim().length > 0 && password.length > 0 && (!needsCode || code.length >= 6) && !busy;

  return (
    <Box
      data-testid="admin-login"
      sx={{
        position: 'relative',
        minHeight: '100dvh',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <AuthAtmosphere />

      <AuthBrand name={t('admin.brand.name')} caption={t('admin.brand.tagline')} />

      <AuthTopControls>
        <GlassPill
          onClick={() => toggleMode()}
          aria-label={mode === 'light' ? t('common.dark') : t('common.light')}
          data-testid="theme-toggle"
        >
          {mode === 'light' ? MoonGlyph : SunGlyph}
        </GlassPill>
      </AuthTopControls>

      <AuthPanel>
        <AuthTitle>{t('admin.login.title')}</AuthTitle>

        <Box component="form" onSubmit={submit} sx={{ mt: { xs: '26px', md: '34px' } }}>
          <Box sx={[lineRowSx, revealSx({ index: 3 })]}>
            <InputBase
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('admin.login.email')}
              autoComplete="username"
              autoFocus
              inputProps={{
                'data-testid': 'admin-login-email',
                'aria-label': t('admin.login.email'),
              }}
              sx={inputSx}
            />
          </Box>

          <Box sx={[lineRowSx, revealSx({ index: 4 })]}>
            <InputBase
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('admin.login.password')}
              autoComplete="current-password"
              inputProps={{
                'data-testid': 'admin-login-password',
                'aria-label': t('admin.login.password'),
              }}
              sx={inputSx}
            />
            {/*
              Пока второй фактор не запрошен, кнопка стоит в строке пароля —
              как в CMS. Когда сервер попросил код, она уезжает в строку кода:
              отправлять форму с пустым кодом всё равно нечем.
            */}
            {needsCode ? null : (
              <AuthSubmitButton
                disabled={!canSubmit}
                busy={busy}
                rtl={rtl}
                label={t('admin.login.submit')}
                testId="admin-login-submit"
              />
            )}
          </Box>

          {needsCode ? (
            <Box sx={[lineRowSx, revealSx({ index: 5 })]}>
              <InputBase
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={t('admin.login.code')}
                autoFocus
                autoComplete="one-time-code"
                inputProps={{
                  'data-testid': 'admin-login-totp',
                  'aria-label': t('admin.login.code'),
                  inputMode: 'numeric',
                  maxLength: 6,
                }}
                sx={inputSx}
              />
              <AuthSubmitButton
                disabled={!canSubmit}
                busy={busy}
                rtl={rtl}
                label={t('admin.login.confirm')}
                testId="admin-login-submit"
              />
            </Box>
          ) : null}

          {error ? <AuthError testId="admin-login-error">{error}</AuthError> : null}

          {needsCode ? <AuthHint index={6}>{t('admin.login.codeHint')}</AuthHint> : null}
        </Box>
      </AuthPanel>
    </Box>
  );
}
