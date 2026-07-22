import { createTheme, alpha, darken, lighten, type Theme } from '@mui/material/styles';
import {
  colorsForMode,
  type BrandTokens,
  type Direction,
  type ThemeMode,
} from './tokens';

/**
 * Extra brand colors that have no MUI palette slot of their own.
 * Components read them via `theme.palette.brand.*` so that the project rule
 * "no hardcoded colors outside tokens.ts" still holds.
 *
 * The base palette is 18 tokens per mode (fixed — the backend derives them from
 * 4–5 anchors and tests pin the count). The richer redesign-v2 vocabulary —
 * strong accent, soft fill, accent glow, a third text level, a radius scale and
 * a depth scale — is DERIVED here from those 18 via pure colour math, so no
 * hardcoded value leaks in and the stored token set stays 18.
 */
export interface BrandPaletteExtension {
  surfaceMuted: string;
  surfaceHover: string;
  surfaceSelected: string;
  scrim: string;
  dropActive: string;
  /** Deeper accent for hover/pressed on primary and display numerals. */
  primaryStrong: string;
  /** Low-alpha accent wash — chips, selected pills, quiet highlights. */
  primarySoft: string;
  /** Accent glow (ready-to-use box-shadow value) — the one bright signal. */
  primaryGlow: string;
  /** Third text level below textSecondary — captions, disabled hints. */
  textTertiary: string;
  /** Radius scale (px). */
  radius: { sm: number; md: number; lg: number; pill: number };
  /** Depth scale — box-shadow strings keyed by level. */
  elevation: { sm: string; md: string; lg: string; glow: string };
}

declare module '@mui/material/styles' {
  interface Palette {
    brand: BrandPaletteExtension;
  }
  interface PaletteOptions {
    brand?: BrandPaletteExtension;
  }
}

/**
 * Builds a MUI theme exclusively from brand tokens.
 * No literal color may appear here — every color comes from `tokens`.
 */
export function createAppTheme(
  tokens: BrandTokens,
  mode: ThemeMode,
  direction: Direction,
): Theme {
  const c = colorsForMode(tokens, mode);
  const { typography, shape, spacingUnit } = tokens;
  const headingFamily = typography.headingFontFamily ?? typography.fontFamily;
  const h = (rem: number) => `${(rem * typography.headingScale).toFixed(3)}rem`;

  // Derived redesign-v2 tokens — pure functions of the 18 base tokens, so the
  // "colours only from tokens" rule holds and nothing hardcoded leaks in.
  const isDark = mode === 'dark';
  const shift = (color: string, amount: number) =>
    isDark ? lighten(color, amount) : darken(color, amount);
  const primaryStrong = shift(c.primary, 0.18);
  const primarySoft = alpha(c.primary, isDark ? 0.16 : 0.1);
  const primaryGlow = `0 0 0 1px ${alpha(c.primary, 0.35)}, 0 8px 30px -8px ${alpha(c.primary, 0.5)}`;
  const textTertiary = alpha(c.textSecondary, 0.72);
  const radius = {
    sm: Math.round(shape.borderRadius * 0.6),
    md: shape.borderRadius,
    lg: shape.borderRadiusLarge,
    pill: 999,
  };
  const elevation = {
    sm: `0 1px 2px ${alpha(c.scrim, 0.5)}`,
    md: `0 8px 24px -14px ${c.scrim}`,
    lg: `0 24px 60px -28px ${c.scrim}`,
    glow: primaryGlow,
  };

  // How elevated surfaces (cards, sheets, popovers) are painted. `flat` keeps the
  // current look, so a hotel that never sets a style sees no change.
  const surfaceStyle = tokens.brand?.surfaceStyle ?? 'flat';
  const surfaceSx =
    surfaceStyle === 'soft'
      ? { boxShadow: `0 10px 30px -18px ${c.scrim}`, border: `1px solid ${c.divider}` }
      : surfaceStyle === 'glass'
        ? {
            backgroundColor: `color-mix(in srgb, ${c.surface} 76%, transparent)`,
            backdropFilter: 'blur(14px)',
            border: `1px solid ${c.divider}`,
          }
        : {};

  return createTheme({
    direction,
    spacing: spacingUnit,
    palette: {
      mode,
      primary: { main: c.primary, contrastText: c.primaryContrast },
      secondary: { main: c.secondary, contrastText: c.secondaryContrast },
      success: { main: c.success },
      warning: { main: c.warning },
      error: { main: c.error },
      info: { main: c.info },
      background: { default: c.background, paper: c.surface },
      text: { primary: c.text, secondary: c.textSecondary },
      divider: c.divider,
      brand: {
        surfaceMuted: c.surfaceMuted,
        surfaceHover: c.surfaceHover,
        surfaceSelected: c.surfaceSelected,
        scrim: c.scrim,
        dropActive: c.dropActive,
        primaryStrong,
        primarySoft,
        primaryGlow,
        textTertiary,
        radius,
        elevation,
      },
    },
    shape: {
      borderRadius: shape.borderRadius,
    },
    typography: {
      fontFamily: typography.fontFamily,
      fontSize: typography.fontSizeBase,
      fontWeightRegular: typography.fontWeightRegular,
      fontWeightMedium: typography.fontWeightMedium,
      fontWeightBold: typography.fontWeightBold,
      h1: { fontFamily: headingFamily, fontSize: h(2.5), fontWeight: typography.fontWeightBold },
      h2: { fontFamily: headingFamily, fontSize: h(2), fontWeight: typography.fontWeightBold },
      h3: { fontFamily: headingFamily, fontSize: h(1.75), fontWeight: typography.fontWeightMedium },
      h4: { fontFamily: headingFamily, fontSize: h(1.5), fontWeight: typography.fontWeightMedium },
      h5: { fontFamily: headingFamily, fontSize: h(1.25), fontWeight: typography.fontWeightMedium },
      h6: { fontFamily: headingFamily, fontSize: h(1.1), fontWeight: typography.fontWeightMedium },
      button: { textTransform: 'none', fontWeight: typography.fontWeightMedium },
    },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: shape.borderRadiusLarge,
            ...surfaceSx,
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          // `elevation === 0` covers the app bar / drop zones which must stay
          // opaque; the surface style only dresses raised paper.
          ...(surfaceStyle === 'flat'
            ? {}
            : { elevation1: surfaceSx, elevation2: surfaceSx, elevation3: surfaceSx }),
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: shape.borderRadius },
        },
      },
    },
  });
}
