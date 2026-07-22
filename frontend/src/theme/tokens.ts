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
  /** Subtle filled surface — list rows, thumbnails placeholders, drop zones. */
  surfaceMuted: string;
  /** Hover state for rows / list items. */
  surfaceHover: string;
  /** Selected row / active navigation item background. */
  surfaceSelected: string;
  /** Scrim drawn over media (image action overlays). */
  scrim: string;
  /** Highlight for an active drag-and-drop drop target. */
  dropActive: string;
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

/** How surfaces (cards, sheets, app bar) are drawn — read when the theme is built. */
export type SurfaceStyle = 'flat' | 'soft' | 'glass';

/** Which mode the storefront opens in for a fresh guest. */
export type DefaultMode = 'light' | 'dark' | 'system';

export type BackgroundKind = 'solid' | 'gradient' | 'image' | 'abstraction';

export interface BrandGradient {
  from: string;
  to: string;
  /** Gradient angle in degrees. */
  angle: number;
}

export interface BrandBackground {
  kind: BackgroundKind;
  /** For `solid` — otherwise the palette background is used. */
  color?: string;
  gradient?: BrandGradient;
  /** For `kind === 'image'`. */
  imageUrl?: string;
  /** Code of a built-in abstraction pattern for `kind === 'abstraction'`. */
  abstraction?: string;
  /** Auto-dimming layer drawn over an image so text stays readable, 0..1. */
  dim?: number;
}

/**
 * Brand-only extras. Optional on purpose: older components ignore them and the
 * platform default leaves them undefined so nothing changes until a hotel opts in.
 */
export interface BrandExtras {
  /** Logo shown on a light surface. */
  logoLight?: string;
  /** Logo shown on a dark surface. */
  logoDark?: string;
  surfaceStyle?: SurfaceStyle;
  defaultMode?: DefaultMode;
  background?: BrandBackground;
}

export interface BrandTokens {
  /** Which hotel these tokens belong to (empty for the platform default). */
  hotelId?: string;
  /** Code of the applied preset, or `custom` once a token is edited by hand. */
  preset?: string;
  palette: {
    light: BrandColorSet;
    dark: BrandColorSet;
  };
  typography: BrandTypographyTokens;
  shape: BrandShapeTokens;
  spacingUnit: number;
  brand?: BrandExtras;
}

export interface PartialBrandExtras {
  logoLight?: string;
  logoDark?: string;
  surfaceStyle?: SurfaceStyle;
  defaultMode?: DefaultMode;
  background?: Partial<BrandBackground>;
}

/** Deep-partial shape used for a hotel's override coming from the backend. */
export type PartialBrandTokens = {
  hotelId?: string;
  preset?: string;
  palette?: {
    light?: Partial<BrandColorSet>;
    dark?: Partial<BrandColorSet>;
  };
  typography?: Partial<BrandTypographyTokens>;
  shape?: Partial<BrandShapeTokens>;
  spacingUnit?: number;
  brand?: PartialBrandExtras;
};

// Платформенный дефолт — тёмно-синий (редизайн v2). Зелёная тема v1 убрана:
// база тёмная, акцент — насыщенный синий. Отель поверх кладёт свой пресет.
export const DEFAULT_BRAND_TOKENS: BrandTokens = {
  preset: 'midnight_navy',
  palette: {
    light: {
      primary: '#1E4E8C',
      primaryContrast: '#FFFFFF',
      secondary: '#9C7A4E',
      secondaryContrast: '#FFFFFF',
      background: '#F4F6FB',
      surface: '#FFFFFF',
      surfaceMuted: '#EAEEF6',
      surfaceHover: '#E4EAF4',
      surfaceSelected: '#DCE6F5',
      scrim: 'rgba(14, 27, 42, 0.55)',
      dropActive: '#D3E0F3',
      text: '#12202F',
      textSecondary: '#5A6B7C',
      divider: '#DCE3EC',
      success: '#2E7D32',
      warning: '#ED6C02',
      error: '#C62828',
      info: '#0277BD',
    },
    dark: {
      primary: '#6EA8DC',
      primaryContrast: '#081524',
      secondary: '#C7A16A',
      secondaryContrast: '#0E1B2A',
      background: '#0C1420',
      surface: '#141F2E',
      surfaceMuted: '#1B283A',
      surfaceHover: '#213247',
      surfaceSelected: '#223B58',
      scrim: 'rgba(4, 9, 16, 0.66)',
      dropActive: '#20385A',
      text: '#E8EFF7',
      textSecondary: '#9DB1C6',
      divider: '#26364A',
      success: '#66BB6A',
      warning: '#FFA726',
      error: '#EF5350',
      info: '#5AA9DE',
    },
  },
  typography: {
    // Дисплейный Onest (заголовки/названия/цены) + интерфейсный Manrope.
    // Обе с кириллицей. Загрузка шрифтов — в index.html.
    fontFamily:
      '"Manrope", system-ui, -apple-system, "Segoe UI", "Noto Sans Arabic", "Noto Sans SC", sans-serif',
    headingFontFamily: '"Onest", system-ui, sans-serif',
    fontSizeBase: 16,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 700,
    headingScale: 1.1,
  },
  shape: {
    borderRadius: 12,
    borderRadiusLarge: 20,
  },
  spacingUnit: 8,
};

function mergeBrandExtras(
  base: BrandExtras | undefined,
  override: PartialBrandExtras | undefined,
): BrandExtras | undefined {
  if (!base && !override) return undefined;
  const background =
    base?.background || override?.background
      ? {
          ...base?.background,
          ...override?.background,
          // `kind` is required on the merged result; fall back to solid.
          kind: override?.background?.kind ?? base?.background?.kind ?? 'solid',
          gradient: override?.background?.gradient ?? base?.background?.gradient,
        }
      : undefined;
  return {
    logoLight: override?.logoLight ?? base?.logoLight,
    logoDark: override?.logoDark ?? base?.logoDark,
    surfaceStyle: override?.surfaceStyle ?? base?.surfaceStyle,
    defaultMode: override?.defaultMode ?? base?.defaultMode,
    background,
  };
}

/** Merge a hotel's partial token override on top of the platform defaults. */
export function mergeBrandTokens(
  override?: PartialBrandTokens,
  base: BrandTokens = DEFAULT_BRAND_TOKENS,
): BrandTokens {
  if (!override) return base;

  return {
    hotelId: override.hotelId ?? base.hotelId,
    preset: override.preset ?? base.preset,
    palette: {
      light: { ...base.palette.light, ...override.palette?.light },
      dark: { ...base.palette.dark, ...override.palette?.dark },
    },
    typography: { ...base.typography, ...override.typography },
    shape: { ...base.shape, ...override.shape },
    spacingUnit: override.spacingUnit ?? base.spacingUnit,
    brand: mergeBrandExtras(base.brand, override.brand),
  };
}

/** Colors for the currently active mode. */
export function colorsForMode(tokens: BrandTokens, mode: ThemeMode): BrandColorSet {
  return tokens.palette[mode];
}

/** The logo to show for a mode, falling back to the other mode's logo. */
export function pickLogo(tokens: BrandTokens, mode: ThemeMode): string | undefined {
  const extras = tokens.brand;
  if (!extras) return undefined;
  const primary = mode === 'dark' ? extras.logoDark : extras.logoLight;
  const fallback = mode === 'dark' ? extras.logoLight : extras.logoDark;
  return primary || fallback || undefined;
}

/** Resolve a concrete light/dark mode from the brand's `defaultMode` preference. */
export function resolveDefaultMode(
  tokens: BrandTokens,
  systemPrefersDark: boolean,
): ThemeMode {
  const pref = tokens.brand?.defaultMode ?? 'light';
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}
