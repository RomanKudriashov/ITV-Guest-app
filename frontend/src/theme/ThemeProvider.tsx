import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CacheProvider } from '@emotion/react';
import createCache, { type EmotionCache } from '@emotion/cache';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { directionForLanguage } from '@/i18n';
import { createAppTheme } from './createAppTheme';
import {
  DEFAULT_BRAND_TOKENS,
  colorsForMode,
  mergeBrandTokens,
  type BrandTokens,
  type Direction,
  type PartialBrandTokens,
  type ThemeMode,
} from './tokens';

const MODE_STORAGE_KEY = 'itv.theme-mode';

interface AppThemeContextValue {
  tokens: BrandTokens;
  mode: ThemeMode;
  direction: Direction;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  /** Apply a hotel's partial token override on top of the platform defaults. */
  setBrandTokens: (override: PartialBrandTokens | undefined) => void;
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

const ltrCache: EmotionCache = createCache({
  key: 'mui',
  stylisPlugins: [prefixer],
});

const rtlCache: EmotionCache = createCache({
  key: 'mui-rtl',
  stylisPlugins: [prefixer, rtlPlugin],
});

function readStoredMode(): ThemeMode | null {
  try {
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

function preferredMode(): ThemeMode {
  const stored = readStoredMode();
  if (stored) return stored;
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export interface AppThemeProviderProps {
  children: ReactNode;
  /** Hotel-specific token override (later fetched from the backend). */
  brandTokens?: PartialBrandTokens;
  /** Force a mode instead of using the stored/system preference. */
  initialMode?: ThemeMode;
}

export function AppThemeProvider({
  children,
  brandTokens,
  initialMode,
}: AppThemeProviderProps) {
  const { i18n } = useTranslation();
  const [mode, setModeState] = useState<ThemeMode>(() => initialMode ?? preferredMode());
  const [override, setOverride] = useState<PartialBrandTokens | undefined>(brandTokens);

  useEffect(() => {
    setOverride(brandTokens);
  }, [brandTokens]);

  const language = i18n.resolvedLanguage ?? i18n.language;
  const direction = directionForLanguage(language);

  const tokens = useMemo(
    () => mergeBrandTokens(override, DEFAULT_BRAND_TOKENS),
    [override],
  );

  const theme = useMemo(
    () => createAppTheme(tokens, mode, direction),
    [tokens, mode, direction],
  );

  // Keep the document in sync with the active language / direction.
  useEffect(() => {
    document.documentElement.setAttribute('dir', direction);
    document.documentElement.setAttribute('lang', language || 'en');
    document.body.setAttribute('dir', direction);
  }, [direction, language]);

  // PWA `theme-color` (the browser/status bar tint) is a color, so it comes from
  // the tokens rather than being written into index.html.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', colorsForMode(tokens, mode).surface);
  }, [tokens, mode]);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      /* storage unavailable (private mode) — mode stays in memory only */
    }
  };

  const value = useMemo<AppThemeContextValue>(
    () => ({
      tokens,
      mode,
      direction,
      setMode,
      toggleMode: () => setMode(mode === 'light' ? 'dark' : 'light'),
      setBrandTokens: setOverride,
    }),
    [tokens, mode, direction],
  );

  return (
    <AppThemeContext.Provider value={value}>
      <CacheProvider value={direction === 'rtl' ? rtlCache : ltrCache}>
        <MuiThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </MuiThemeProvider>
      </CacheProvider>
    </AppThemeContext.Provider>
  );
}

export function useAppTheme(): AppThemeContextValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used inside <AppThemeProvider>');
  }
  return ctx;
}
