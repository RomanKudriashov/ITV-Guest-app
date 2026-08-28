import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import InputBase from '@mui/material/InputBase';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';

import { ApiError, session } from '@/api/client';
import { useAuth } from '@/auth';
import { landingPath } from '@/auth/home';
import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '@/i18n';
import { AuthAtmosphere } from '@/kit/AuthAtmosphere';
import {
  AuthBrand,
  AuthError,
  AuthHint,
  AuthPanel,
  AuthSubmitButton,
  AuthSubtitle,
  AuthTitle,
  AuthTopControls,
  GlassPill,
  GlobeGlyph,
  MoonGlyph,
  SunGlyph,
  inputSx,
  lineRowSx,
} from '@/kit/auth';
import { revealSx } from '@/kit/motion';
import { useAppTheme } from '@/theme';
import { pickLogo } from '@/theme';

const TIME_SLOTS = ['night', 'morning', 'afternoon', 'evening'] as const;

function greetingSlot(hour: number): (typeof TIME_SLOTS)[number] {
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/**
 * Вход в CMS отеля — полотно по эталону `docs/design/login-ac.html`.
 *
 * Разметка экрана живёт в `kit/auth`: тем же кодом набран вход в консоль
 * платформы. Пока каждый экран держал свою копию, они разъехались до
 * неузнаваемости — карточка против полотна.
 */
export function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated, user } = useAuth();
  const { tokens, mode, direction, toggleMode } = useAppTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  /*
    Повод возврата на вход. Сессия, кончившаяся посреди работы, обязана
    объясниться: без этого человек видит форму входа вместо своего экрана и
    считает, что его «выкинуло» без причины.
  */
  const [error, setError] = useState<string | null>(
    session.hasExpired() ? t('auth.sessionExpired') : null,
  );
  const [busy, setBusy] = useState(false);
  const [langAnchor, setLangAnchor] = useState<HTMLElement | null>(null);

  // Куда вести — решает ПРАВО, а не название роли, и считается это в одном
  // месте (`auth/home.ts`). `from` уважается, но не когда ведёт в закрытый
  // раздел: иначе собственная закладка повара снова приводила бы его к отказу.
  const requested = (location.state as { from?: string } | null)?.from ?? null;

  /*
    ЖДЁМ, ПОКА ПРАВА ИЗВЕСТНЫ. Токен из хранилища делает `isAuthenticated`
    истиной СРАЗУ, а `user` приезжает ответом `/auth/me` позже. Посчитав
    посадку в этот промежуток, мы считаем её по `null` — то есть «прав нет» —
    и увозим на доску даже администратора.

    Ждём именно ПОЛЬЗОВАТЕЛЯ, а не окончания начальной загрузки: вход под
    аудитом получает токен обменом одноразового кода, и ответ обмена прав не
    несёт вовсе — только `access`. Права приезжают следующим запросом
    `/auth/me`, и до него посадку считать не по чему.

    Поймано прогоном: вход под аудитом приземлялся на `/tracker` вместо
    раздела CMS. Пустой экран на долю секунды здесь дешевле неверного адреса;
    если `/auth/me` откажет, провайдер разлогинит, и покажется форма.
  */
  if (isAuthenticated && !user) return null;
  if (isAuthenticated) return <Navigate to={landingPath(user, requested)} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Считаем по ВОЗВРАЩЁННОМУ пользователю, а не по `user` из замыкания:
      // тот ещё от прошлого рендера и на первом входе всегда пуст.
      const me = await login(email.trim(), password);
      navigate(landingPath(me, requested), { replace: true });
    } catch (loginError) {
      const message =
        loginError instanceof ApiError ? loginError.detail : t('auth.networkError');
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  const logoSrc = pickLogo(tokens, mode);
  const brandName = t('app.title');
  const greeting = t(`auth.greetings.${greetingSlot(new Date().getHours())}`);
  const rtl = direction === 'rtl';

  const current = (i18n.resolvedLanguage ?? i18n.language ?? 'en') as SupportedLanguage;
  const currentLabel = SUPPORTED_LANGUAGES.includes(current)
    ? LANGUAGE_LABELS[current]
    : LANGUAGE_LABELS.en;

  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '100dvh',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <AuthAtmosphere />

      <AuthBrand logoSrc={logoSrc} name={brandName} logoTestId="login-brand-logo" />

      <AuthTopControls>
        <GlassPill
          onClick={(event) => setLangAnchor(event.currentTarget)}
          aria-haspopup
          aria-label={t('common.language')}
          data-testid="language-switcher"
        >
          {GlobeGlyph}
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
            {currentLabel}
          </Box>
        </GlassPill>
        <GlassPill
          onClick={() => toggleMode()}
          aria-label={mode === 'light' ? t('common.dark') : t('common.light')}
          data-testid="theme-toggle"
        >
          {mode === 'light' ? MoonGlyph : SunGlyph}
        </GlassPill>
      </AuthTopControls>

      <Menu
        anchorEl={langAnchor}
        open={Boolean(langAnchor)}
        onClose={() => setLangAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: rtl ? 'left' : 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: rtl ? 'left' : 'right' }}
      >
        {SUPPORTED_LANGUAGES.map((code) => (
          <MenuItem
            key={code}
            selected={code === current}
            onClick={() => {
              void i18n.changeLanguage(code);
              setLangAnchor(null);
            }}
          >
            {LANGUAGE_LABELS[code]}
          </MenuItem>
        ))}
      </Menu>

      <AuthPanel>
        <AuthTitle tight>{greeting}</AuthTitle>
        <AuthSubtitle>{t('auth.subtitle')}</AuthSubtitle>

        <Box component="form" onSubmit={submit} sx={{ mt: { xs: '26px', md: '34px' } }}>
          <Box sx={[lineRowSx, revealSx({ index: 3 })]}>
            <InputBase
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('auth.email')}
              autoComplete="username"
              autoFocus
              inputProps={{
                'data-testid': 'login-email',
                'aria-label': t('auth.email'),
              }}
              sx={inputSx}
            />
          </Box>

          <Box sx={[lineRowSx, revealSx({ index: 4 })]}>
            <InputBase
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('auth.password')}
              autoComplete="current-password"
              inputProps={{
                'data-testid': 'login-password',
                'aria-label': t('auth.password'),
              }}
              sx={inputSx}
            />
            <AuthSubmitButton
              disabled={!canSubmit}
              busy={busy}
              rtl={rtl}
              label={t('auth.submit')}
              testId="login-submit"
            />
          </Box>

          {error ? <AuthError testId="login-error">{error}</AuthError> : null}

          {/*
            Подсказка (эталон `.hint` — тире + текст).

            Здесь были демо-креды. Экран входа в панель отеля — не витрина
            демо-стенда: логин и пароль, напечатанные под формой, работают
            ровно как приглашение войти чужому, и первый же реальный отель
            увидел бы их на своём поддомене.
          */}
          <AuthHint>{t('auth.accessHint')}</AuthHint>
        </Box>
      </AuthPanel>
    </Box>
  );
}
