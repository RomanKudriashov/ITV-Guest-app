import { createTheme, alpha, darken, lighten, type Theme } from '@mui/material/styles';
import { fontPx } from './fontPx';
import { mix, readable } from './contrast';
import {
  colorsForMode,
  type BrandTokens,
  type Direction,
  type SurfaceStyle,
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
  /**
   * Характер поверхностей, выбранный отелем: плоский, мягкий или стекло.
   *
   * Лежит в палитре, потому что его спрашивает ВИТРИНА: карточки она рисует
   * своими токенами, а не `Paper` MUI, и другого способа узнать выбор у неё
   * нет. См. `cardSurface` в словаре витрины.
   */
  surfaceStyle: SurfaceStyle;
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
  /** Акцент как ЦВЕТ ТЕКСТА: primary, доведённый до 4.5:1 на всех фонах темы. */
  primaryText: string;
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
  /*
    Заголовки — через ту же шкалу, что и витрина (партия 24): и размер текста,
    и масштаб заголовков. Было `rem × headingScale` — размер текста до
    заголовков темы не доходил, а переменная `--heading-scale` в корне
    стояла, но ими не читалась.
  */
  const h = (rem: number) => fontPx(rem * 16, 'heading');

  // Derived redesign-v2 tokens — pure functions of the 18 base tokens, so the
  // "colours only from tokens" rule holds and nothing hardcoded leaks in.
  const isDark = mode === 'dark';
  const shift = (color: string, amount: number) =>
    isDark ? lighten(color, amount) : darken(color, amount);
  const primaryStrong = shift(c.primary, 0.18);
  const primarySoft = alpha(c.primary, isDark ? 0.16 : 0.1);
  const primaryGlow = `0 0 0 1px ${alpha(c.primary, 0.35)}, 0 8px 30px -8px ${alpha(c.primary, 0.5)}`;
  /*
    ТЕКСТ — НЕ НИЖЕ 4.5:1 НА ЛЮБОМ ФОНЕ ТЕМЫ (партия 55). Фоны — все, на
    которых лежит текст: страница, поверхность, приглушённая и выбранная.
    Третий уровень был `alpha(textSecondary, .72)` — 3.81 на фоне страницы, и
    им написаны подписи групп меню, роли, мета строк. Теперь он сплошной:
    между вторичным и основным, но не тише планки. Акцент как текст (активный
    пункт меню, текстовые кнопки, вкладки) — отдельный `primaryText`: заливки
    кнопок остаются цветом бренда, а буквы на поверхности — читаемыми.
  */
  const textBackgrounds = [c.background, c.surface, c.surfaceMuted, c.surfaceSelected];
  const textSecondary = readable(c.textSecondary, textBackgrounds, mode);
  const textTertiary = readable(mix(c.textSecondary, c.surface, 0.28), textBackgrounds, mode);
  const primaryText = readable(c.primary, textBackgrounds, mode);
  const errorText = readable(c.error, textBackgrounds, mode);
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
      // Ошибка — это прежде всего ТЕКСТ (подсказки полей, «просрочено»): main
      // доводится до читаемого так же, как вторичный текст.
      error: { main: errorText },
      // Текст на залитых цветах (чипы, кнопки) MUI выбирает сам — с той же
      // планкой 4.5, а не с порогом 3 по умолчанию: белое на #EF5350 давало
      // 3.4 у «Просрочено» в тёмной теме.
      contrastThreshold: 4.5,
      info: { main: c.info },
      background: { default: c.background, paper: c.surface },
      text: { primary: c.text, secondary: textSecondary },
      divider: c.divider,
      brand: {
        // Стиль поверхности КЛАДЁТСЯ В ПАЛИТРУ, а не остаётся локальной
        // переменной: витрина рисует карточки своими токенами и обязана уметь
        // спросить, какой характер выбрал отель. Пока он жил только здесь,
        // настройка меняла лишь `Paper` и `Card` MUI — то есть панель и показ,
        // но не гостя.
        surfaceStyle,
        surfaceMuted: c.surfaceMuted,
        surfaceHover: c.surfaceHover,
        surfaceSelected: c.surfaceSelected,
        scrim: c.scrim,
        dropActive: c.dropActive,
        primaryStrong,
        primarySoft,
        primaryGlow,
        textTertiary,
        primaryText,
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
      MuiCssBaseline: {
        styleOverrides: {
          /*
            ШКАЛА КЕГЛЯ — В КОРНЕ ДОКУМЕНТА, ОДНОЙ ПЕРЕМЕННОЙ.

            Витрина рисует размеры в пикселях (`fontSize: 33`), и настройка
            размера текста до них не доходила: тема меняла только то, что
            кегля не задаёт. Переменная решает это в одном месте — а `fontPx`
            в витрине переводит авторский пиксель в масштабированный.

            16 в знаменателе — не магия: это `fontSizeBase` по умолчанию, тот
            размер, в котором нарисована вся витрина. Ползунок сдвигает всё
            относительно него.
          */
          ':root': {
            '--type-scale': (typography.fontSizeBase / 16).toFixed(4),
            '--heading-scale': typography.headingScale.toFixed(4),
          },
          /*
            ПОЛЯ И КНОПКИ — ШРИФТОМ БРЕНДА, А НЕ БРАУЗЕРА (партия 24).

            Браузер задаёт `button` и полям собственный системный шрифт, а не
            наследует его. `Button` MUI шрифт ставит сам, голый `ButtonBase` —
            нет: плитки главной, плашки меток, «К сервисам», пилюли номера
            рисовались Arial при любом шрифте отеля. Наследование — здесь, в
            одном месте, а не заплаткой на каждом экране.
          */
          'button, input, select, textarea': { fontFamily: 'inherit' },
        },
      },
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
          // Текстовые и контурные кнопки — акцент как ТЕКСТ на поверхности.
          textPrimary: { color: primaryText },
          outlinedPrimary: { color: primaryText },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { '&.Mui-selected': { color: primaryText } },
        },
      },
      MuiLink: {
        styleOverrides: {
          root: { color: primaryText },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          /*
            ОТСТУП ПОСЛЕ ЗАГОЛОВКА — ДЛЯ ПОДНЯТОЙ ПОДПИСИ ПОЛЯ (партия 54).

            MUI сам обнуляет верхний отступ содержимого, если перед ним стоит
            заголовок (`.MuiDialogTitle-root + &`), а содержимое режет всё, что
            выходит за его верх (`overflow-y: auto`). Подпись первого поля при
            вводе поднимается на рамку — выше поля — и срезалась: в «Войти в
            отель» от «Причины входа» оставалась нижняя треть. `sx` диалога это
            не перебивает: у правила MUI селектор весомее. Здесь — тот же вес и
            позже по порядку, поэтому выигрывает на всех поверхностях сразу.
          */
          root: { '.MuiDialogTitle-root + &': { paddingTop: 12 } },
        },
      },
    },
  });
}
