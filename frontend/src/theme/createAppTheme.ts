import { createTheme, type Theme } from '@mui/material/styles';
import {
  colorsForMode,
  type BrandTokens,
  type Direction,
  type ThemeMode,
} from './tokens';

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
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: shape.borderRadius },
        },
      },
    },
  });
}
