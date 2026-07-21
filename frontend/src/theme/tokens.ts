/**
 * Brand tokens — the single source of truth for the visual identity of a hotel.
 *
 * PROJECT RULE: no hardcoded colors anywhere outside this file.
 * Never write `#fff`, `rgb(...)`, `red`, etc. in components, styles or sx props.
 * Always read colors from the theme (`theme.palette.*`) which is built from these
 * tokens by `createAppTheme`. If a new color is needed, add it to BrandTokens here.
 *
 * Tokens are per-hotel and are delivered by the backend (multi-tenant SaaS).
 * Until that endpoint exists, DEFAULT_BRAND_TOKENS is used and a hotel's partial
 * override is merged on top via `mergeBrandTokens`.
 */

export type ThemeMode = 'light' | 'dark';
export type Direction = 'ltr' | 'rtl';

export interface BrandColorSet {
  /** Main brand color — primary actions, active states. */
  primary: string;
  primaryContrast: string;
  /** Accent color — secondary actions, highlights. */
  secondary: string;
  secondaryContrast: string;
  /** App background (behind surfaces). */
  background: string;
  /** Cards, sheets, app bar. */
  surface: string;
  /** Text on background/surface. */
  text: string;
  textSecondary: string;
  /** Hairlines, outlines, dividers. */
  divider: string;
  /** Status colors. */
  success: string;
  warning: string;
  error: string;
  info: string;
}

export interface BrandTypographyTokens {
  fontFamily: string;
  /** Font family used for headings; falls back to fontFamily when omitted. */
  headingFontFamily?: string;
  fontSizeBase: number;
  fontWeightRegular: number;
  fontWeightMedium: number;
  fontWeightBold: number;
  /** Multiplier applied to heading sizes, lets a hotel scale its type. */
  headingScale: number;
}

export interface BrandShapeTokens {
  borderRadius: number;
  /** Radius for large surfaces (cards, sheets, dialogs). */
  borderRadiusLarge: number;
}

export interface BrandTokens {
  /** Which hotel these tokens belong to (empty for the platform default). */
  hotelId?: string;
  palette: {
    light: BrandColorSet;
    dark: BrandColorSet;
  };
  typography: BrandTypographyTokens;
  shape: BrandShapeTokens;
  spacingUnit: number;
}

/** Deep-partial shape used for a hotel's override coming from the backend. */
export type PartialBrandTokens = {
  hotelId?: string;
  palette?: {
    light?: Partial<BrandColorSet>;
    dark?: Partial<BrandColorSet>;
  };
  typography?: Partial<BrandTypographyTokens>;
  shape?: Partial<BrandShapeTokens>;
  spacingUnit?: number;
};

export const DEFAULT_BRAND_TOKENS: BrandTokens = {
  palette: {
    light: {
      primary: '#1F6F5C',
      primaryContrast: '#FFFFFF',
      secondary: '#C8A24A',
      secondaryContrast: '#1B1B1B',
      background: '#F6F7F5',
      surface: '#FFFFFF',
      text: '#12211D',
      textSecondary: '#5A6B66',
      divider: '#DCE3E0',
      success: '#2E7D32',
      warning: '#ED6C02',
      error: '#C62828',
      info: '#0277BD',
    },
    dark: {
      primary: '#5FBFA5',
      primaryContrast: '#08211B',
      secondary: '#DFC078',
      secondaryContrast: '#1B1B1B',
      background: '#0F1512',
      surface: '#18211E',
      text: '#E8F0ED',
      textSecondary: '#9CB0AA',
      divider: '#2A3733',
      success: '#66BB6A',
      warning: '#FFA726',
      error: '#EF5350',
      info: '#29B6F6',
    },
  },
  typography: {
    fontFamily:
      '"Inter", "Segoe UI", system-ui, -apple-system, "Noto Sans Arabic", "Noto Sans SC", sans-serif',
    fontSizeBase: 16,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 700,
    headingScale: 1,
  },
  shape: {
    borderRadius: 10,
    borderRadiusLarge: 18,
  },
  spacingUnit: 8,
};

/** Merge a hotel's partial token override on top of the platform defaults. */
export function mergeBrandTokens(
  override?: PartialBrandTokens,
  base: BrandTokens = DEFAULT_BRAND_TOKENS,
): BrandTokens {
  if (!override) return base;

  return {
    hotelId: override.hotelId ?? base.hotelId,
    palette: {
      light: { ...base.palette.light, ...override.palette?.light },
      dark: { ...base.palette.dark, ...override.palette?.dark },
    },
    typography: { ...base.typography, ...override.typography },
    shape: { ...base.shape, ...override.shape },
    spacingUnit: override.spacingUnit ?? base.spacingUnit,
  };
}

/** Colors for the currently active mode. */
export function colorsForMode(tokens: BrandTokens, mode: ThemeMode): BrandColorSet {
  return tokens.palette[mode];
}
