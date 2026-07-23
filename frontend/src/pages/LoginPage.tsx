import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import InputBase from '@mui/material/InputBase';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import { alpha, type Theme } from '@mui/material/styles';

import { ApiError } from '@/api/client';
import { useAuth } from '@/auth';
import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '@/i18n';
import { AuthAtmosphere } from '@/kit/AuthAtmosphere';
import { revealSx } from '@/kit/motion';
import { useAppTheme } from '@/theme';
import { pickLogo } from '@/theme';

/* ── vector glyphs (line style, currentColor — no emoji, no raster) ───────── */

function Glyph({ children }: { children: ReactNode }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      sx={{ width: 18, height: 18, display: 'block' }}
    >
      {children}
    </Box>
  );
}

const ArrowGlyph = (
  <Glyph>
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </Glyph>
);

const GlobeGlyph = (
  <Glyph>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3c2.5 2.4 3.8 5.6 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.6-3.8-9S9.5 5.4 12 3z" />
  </Glyph>
);

const MoonGlyph = (
  <Glyph>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Glyph>
);

const SunGlyph = (
  <Glyph>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Glyph>
);

/* ── glass pill (reference `.gh`) with a ≥44px hit target ───────────────────── */

function GlassPill({
  onClick,
  children,
  ...rest
}: {
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  children: ReactNode;
  'data-testid'?: string;
  'aria-label'?: string;
  'aria-haspopup'?: boolean;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      {...rest}
      sx={(theme: Theme) => ({
        // Interactive target ≥44px; the visible pill stays 34px (reference).
        minHeight: 44,
        borderRadius: `${theme.palette.brand.radius.pill}px`,
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.common.white}`,
          outlineOffset: 2,
        },
      })}
    >
      <Box
        sx={(theme: Theme) => ({
          height: 34,
          px: '13px',
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          borderRadius: `${theme.palette.brand.radius.pill}px`,
          border: `1px solid ${alpha(theme.palette.common.white, 0.22)}`,
          backgroundColor: alpha(theme.palette.common.black, 0.28),
          color: theme.palette.common.white,
          fontSize: 12,
          fontWeight: theme.typography.fontWeightBold,
          transition: 'background-color .2s',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        })}
      >
        {children}
      </Box>
    </ButtonBase>
  );
}

/* ── line input (reference `.lineinp`) ──────────────────────────────────────── */

function lineRowSx(theme: Theme) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    px: '2px',
    py: '13px',
    borderBottom: `1px solid ${alpha(theme.palette.common.white, 0.28)}`,
    transition: 'border-color .25s',
    '&:hover': { borderColor: alpha(theme.palette.common.white, 0.6) },
    '&:focus-within': { borderColor: alpha(theme.palette.common.white, 0.6) },
    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
  } as const;
}

// ВАЖНО (причина прошлого белого экрана): стандартный `::placeholder` в sx роняет
// stylis-prefixer — разворачивая вендор-префиксы псевдоэлемента, он обращается к
// коллекции детей узла, которой там нет → `.push` of undefined, весь экран падает.
// Поэтому `::placeholder` в рантайм-sx НЕ пишем, а задаём плейсхолдер уже-
// префиксными селекторами (`::-webkit-input-placeholder`, `::-moz-placeholder`) —
// их prefixer не трогает. Storefront не стилизовал плейсхолдер, поэтому там не
// всплывало; правило теперь общее.
const inputSx = (theme: Theme) => {
  const placeholder = { color: alpha(theme.palette.common.white, 0.42), opacity: 1 };
  return {
    flex: 1,
    color: theme.palette.common.white,
    fontWeight: theme.typography.fontWeightMedium,
    fontSize: { xs: 17, md: 19 },
    '& input': {
      padding: 0,
      color: theme.palette.common.white,
    },
    '& input::-webkit-input-placeholder': placeholder,
    '& input::-moz-placeholder': placeholder,
  };
};

const TIME_SLOTS = ['night', 'morning', 'afternoon', 'evening'] as const;

function greetingSlot(hour: number): (typeof TIME_SLOTS)[number] {
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated } = useAuth();
  const { tokens, mode, direction, toggleMode } = useAppTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [langAnchor, setLangAnchor] = useState<HTMLElement | null>(null);

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

      {/* logo — top-inline-start (reference `.a .mark` left:56 top:34) */}
      <Box
        sx={(theme: Theme) => ({
          position: 'absolute',
          insetInlineStart: { xs: 24, md: 56 },
          insetBlockStart: { xs: 26, md: 34 },
          zIndex: 7,
          color: theme.palette.common.white,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          ...revealSx({ index: 0 }),
        })}
      >
        {logoSrc ? (
          <Box
            component="img"
            src={logoSrc}
            alt={brandName}
            data-testid="login-brand-logo"
            sx={{ height: { xs: 26, md: 32 }, width: 'auto', display: 'block' }}
          />
        ) : (
          <>
            <Box
              component="svg"
              viewBox="0 0 40 40"
              aria-hidden
              sx={{ width: { xs: 26, md: 32 }, height: { xs: 26, md: 32 }, opacity: 0.92 }}
            >
              <path
                d="M20 3.5 L34.5 16 L20 36.5 L5.5 16 Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <path
                d="M5.5 16 H34.5 M20 3.5 V36.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.7"
                opacity="0.5"
              />
            </Box>
            <Typography
              component="span"
              sx={(theme: Theme) => ({
                fontFamily: theme.typography.h1.fontFamily,
                fontSize: { xs: 15, md: 17 },
                fontWeight: theme.typography.fontWeightMedium,
                lineHeight: 1.1,
              })}
            >
              {brandName}
            </Typography>
          </>
        )}
      </Box>

      {/* language + theme pills — top-inline-end (reference `.topr`) */}
      <Box
        sx={{
          position: 'absolute',
          insetBlockStart: { xs: 24, md: 22 },
          insetInlineEnd: { xs: 20, md: 24 },
          zIndex: 8,
          display: 'flex',
          gap: '8px',
          ...revealSx({ index: 0 }),
        }}
      >
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
      </Box>

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

      {/* greeting + sign-in — bottom-inline-start (reference `.a .body`) */}
      <Box
        sx={{
          position: 'absolute',
          insetInlineStart: { xs: 24, md: 56 },
          insetInlineEnd: { xs: 24, md: 'auto' },
          insetBlockEnd: { xs: 44, md: 62 },
          zIndex: 6,
          width: { xs: 'auto', md: 'min(470px, 60%)' },
        }}
      >
        <Typography
          component="h1"
          sx={(theme: Theme) => ({
            fontFamily: theme.typography.h1.fontFamily,
            fontWeight: theme.typography.fontWeightBold,
            color: theme.palette.common.white,
            fontSize: { xs: 38, md: 58 },
            lineHeight: 0.98,
            letterSpacing: '-0.035em',
            maxWidth: { xs: '7ch', md: 'none' },
            ...revealSx({ index: 1 }),
          })}
        >
          {greeting}
        </Typography>

        <Typography
          sx={(theme: Theme) => ({
            color: alpha(theme.palette.common.white, 0.6),
            fontSize: 14.5,
            mt: '13px',
            maxWidth: 400,
            ...revealSx({ index: 2 }),
          })}
        >
          {t('auth.subtitle')}
        </Typography>

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
            <ButtonBase
              type="submit"
              disabled={!canSubmit}
              data-testid="login-submit"
              aria-label={t('auth.submit')}
              sx={(theme: Theme) => ({
                flex: 'none',
                width: { xs: 42, md: 46 },
                height: { xs: 42, md: 46 },
                borderRadius: '50%',
                color: theme.palette.common.white,
                border: `1px solid ${alpha(theme.palette.common.white, 0.35)}`,
                backgroundColor: alpha(theme.palette.common.white, 0.06),
                transition: 'background-color .22s, transform .18s, color .22s',
                '&:hover': {
                  backgroundColor: theme.palette.common.white,
                  color: theme.palette.common.black,
                  transform: rtl ? 'translateX(-3px)' : 'translateX(3px)',
                },
                '&.Mui-disabled': { opacity: 0.5 },
                '&.Mui-focusVisible': {
                  outline: `2px solid ${theme.palette.common.white}`,
                  outlineOffset: 2,
                },
                '@media (prefers-reduced-motion: reduce)': {
                  transition: 'none',
                },
              })}
            >
              {busy ? <CircularProgress size={18} color="inherit" /> : ArrowGlyph}
            </ButtonBase>
          </Box>

          {error ? (
            <Box
              role="alert"
              data-testid="login-error"
              sx={(theme: Theme) => ({
                mt: '16px',
                px: '12px',
                py: '8px',
                borderRadius: `${theme.palette.brand.radius.sm}px`,
                border: `1px solid ${alpha(theme.palette.error.main, 0.5)}`,
                backgroundColor: alpha(theme.palette.error.main, 0.16),
                color: theme.palette.common.white,
                fontSize: 13,
              })}
            >
              {error}
            </Box>
          ) : null}

          {/* hint (reference `.hint` — dash + text) */}
          <Box
            sx={(theme: Theme) => ({
              mt: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '9px',
              color: alpha(theme.palette.common.white, 0.4),
              fontSize: 12.5,
              ...revealSx({ index: 5 }),
            })}
          >
            <Box
              aria-hidden
              sx={(theme: Theme) => ({
                width: 26,
                height: 1,
                flex: 'none',
                backgroundColor: alpha(theme.palette.common.white, 0.28),
              })}
            />
            {t('auth.demoHint', {
              email: 'chef@crystal.local',
              password: 'chef12345',
            })}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
