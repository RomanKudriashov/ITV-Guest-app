import { alpha, type Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';

/**
 * СТЕКЛО ДЛЯ ПАНЕЛИ И NaviRoom Control (партия 56).
 *
 * Правило: стекло — на «рамке» (меню, шапка, плитки, окна, плавающие панели,
 * меню и выпадашки), содержимое — плотное (таблицы, поля, длинные тексты).
 * Числа — из уровней витрины гостя (`guest/storefrontTokens.ts`, `glass.*`),
 * но цвета не литералами, а из палитры темы: стекло работает и в бренде отеля,
 * и в платформенной теме консоли.
 *
 * ФОЛБЭК ПО УМОЛЧАНИЮ. Базовые свойства — непрозрачная подложка того же цвета;
 * прозрачность и размытие включаются только внутри `@supports` (браузер умеет
 * `backdrop-filter`) — а `prefers-reduced-transparency: reduce` их выключает.
 * Без этого полупрозрачная тёмная панель без размытия читалась бы хуже, чем
 * простая непрозрачная (в витрине так и есть: фолбэка там нет).
 *
 * ЦЕНА. Размытие пересчитывается, когда под стеклом движется содержимое.
 * Замер партии 56 на доске трекера (300 карточек, прокрутка): без стекла
 * ~88 к/с, стекло на шапке ~65, на всех карточках ~45 (×4 CPU — 37 и 42 долгих
 * кадра из 146). Отсюда: на карточках доски стекла нет; размытие — у рамки.
 */

export type GlassLevel = 'bar' | 'panel' | 'sheet' | 'menu';

/** Доля поверхности в цвете стекла: светлая / тёмная тема. */
const ALPHA: Record<GlassLevel, { light: number; dark: number }> = {
  bar: { light: 0.72, dark: 0.62 },
  panel: { light: 0.62, dark: 0.5 },
  sheet: { light: 0.86, dark: 0.74 },
  menu: { light: 0.82, dark: 0.72 },
};

/** Радиус размытия, px. */
const BLUR: Record<GlassLevel, number> = { bar: 20, panel: 16, sheet: 24, menu: 18 };

export const GLASS_SUPPORTS = '@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))';
export const GLASS_REDUCED = '@media (prefers-reduced-transparency: reduce)';
const SUPPORTS = GLASS_SUPPORTS;
const REDUCED = GLASS_REDUCED;

/** Тонкая светлая кромка: блик по краю стекла. */
export function glassEdge(theme: Theme): string {
  const dark = theme.palette.mode === 'dark';
  return `1px solid ${alpha(theme.palette.common.white, dark ? 0.09 : 0.6)}`;
}

/** Мягкая тень стекла — от цвета затемнения темы, без жёсткого края. */
export function glassShadow(theme: Theme): string {
  const dark = theme.palette.mode === 'dark';
  return `0 10px 34px -18px ${alpha(theme.palette.brand.scrim, dark ? 0.9 : 0.55)}`;
}

export function glassSx(
  theme: Theme,
  level: GlassLevel,
  { edge = true, shadow = true, blur = true } = {},
): SystemStyleObject<Theme> {
  const dark = theme.palette.mode === 'dark';
  const surface = theme.palette.background.paper;
  // Без размытия — только полупрозрачность: там, где под стеклом ничего не
  // движется (левое меню над неподвижной подложкой), размытие — пустая цена.
  const filter = blur ? `blur(${BLUR[level]}px) saturate(1.5)` : 'none';
  return {
    // Без поддержки размытия — непрозрачная подложка того же цвета.
    backgroundColor: surface,
    backgroundImage: 'none',
    ...(edge ? { border: glassEdge(theme) } : {}),
    ...(shadow ? { boxShadow: glassShadow(theme) } : {}),
    [SUPPORTS]: {
      backgroundColor: alpha(surface, ALPHA[level][dark ? 'dark' : 'light']),
      backdropFilter: filter,
      // stylis сам префикс не ставит — Safari до 18 без него не размывает.
      WebkitBackdropFilter: filter,
    },
    [REDUCED]: {
      backgroundColor: surface,
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
    },
  };
}

/**
 * Плотное содержимое на стекле: таблицы, поля, длинные тексты. Непрозрачно —
 * контраст текста не зависит от того, что просвечивает (планка 4.5, партия 55).
 */
export function solidSx(theme: Theme): SystemStyleObject<Theme> {
  return {
    backgroundColor: theme.palette.background.paper,
    borderRadius: `${theme.palette.brand.radius.lg}px`,
  };
}
