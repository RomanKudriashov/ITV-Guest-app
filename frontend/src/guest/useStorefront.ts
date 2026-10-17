/**
 * Набор витрины для активного режима — С УЧЁТОМ ВЫБОРА ОТЕЛЯ.
 *
 * Хук, а не импорт констант: значения стекла и скримов зависят от темы, и
 * компонент, который берёт их напрямую, молча остаётся в одном режиме. Раньше
 * так и было — витрина импортировала плоские тёмные объекты, и светлая тема до
 * неё не доходила.
 *
 * ТЕПЕРЬ ХУК ЕЩЁ И ПРИМЕНЯЕТ НАСТРОЙКИ БРЕНДА, и делает это В ОДНОМ МЕСТЕ:
 *
 *   * акцент отеля заменяет жёсткое золото в управлении номером — но только
 *     если он там различим (см. `roomControlAccent`);
 *   * характер поверхности карточек берётся из выбранного стиля;
 *   * за витриной фото бренда — стекло поверхностей плотнеет до контраста
 *     (партия 58б, см. `densify`).
 *
 * Место выбрано не случайно. Эти настройки должны действовать и у гостя, и в
 * показе бренда, а показ рисует те же компоненты внутри своей темы — значит
 * достаточно, чтобы решение принималось там, где компонент спрашивает токены.
 * Раздать его по местам применения значило бы завести два ответа на один
 * вопрос и однажды показать отелю одно, а гостю другое.
 */

import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';

import { useAppTheme } from '@/theme';
import { photoPlateAlpha, readable } from '@/theme/contrast';
import { decomposeColor } from '@mui/material/styles';
import {
  TEXT_CONTRAST,
  cardSurface,
  overlayColor,
  roomControlAccent,
  storefrontTokens,
  type StorefrontTokens,
  type SurfaceTokens,
} from './storefrontTokens';

export interface StorefrontSet extends StorefrontTokens {
  /** Поверхность карточки: плоская, мягкая или стеклянная — по выбору отеля. */
  cardSurface: SurfaceTokens;
  /** Взят ли запасной акцент управления номером вместо выбранного. */
  roomAccentIsSpare: boolean;
  /**
   * Цвета БУКВ состояния номера — акцент, холодный и нейтральный тон как
   * текст (партия 56). Заливки и обводки остаются цветом отеля (им хватает
   * 3:1), а буквам нужно 4.5: акцент «Кристалла» на светлой давал 3.4–3.9
   * на пилюле «Блэкаут закрыт». Доводятся `readable` к подложке пилюли поверх
   * страницы и карточки — у любого бренда, а не подбором под один.
   */
  roomText: { accent: string; cold: string; neutral: string };
}

/** Запас над 4.5: браузер округляет наложение, и ровно 4.50 замеряется как 4.49. */
const TEXT_MARGIN = 0.15;

/**
 * СТЕКЛО НАД ФОТО ФОНА — ПЛОТНОСТЬЮ ИЗ КОНТРАСТА (партия 58б).
 *
 * Вуаль на весь экран снята: фото бренда за витриной видно. Стекло карточек,
 * панелей и строк (0,38–0,76) держало текст, пока под ним лежала вуаль; над
 * голым фото сквозь карточку читался кадр, а подпись — нет. Плотность стекла
 * поднимается до той, при которой его текст держит 4,5 на ЛЮБОМ пикселе кадра
 * (`photoPlateAlpha`, + запас); прозрачнее, чем было, оно не становится.
 * Фото видно в зазорах между карточками и по краям — там, где текста нет.
 */
const DENSE_MARGIN = 0.04;

function densify(color: string, texts: string[]): string {
  const parts = decomposeColor(color).values;
  const alpha = parts.length > 3 ? (parts[3] ?? 1) : 1;
  const [r, g, b] = parts.slice(0, 3).map(Math.round);
  const need = Math.min(1, photoPlateAlpha(`rgb(${r},${g},${b})`, texts) + DENSE_MARGIN);
  return `rgba(${r},${g},${b},${Math.max(alpha, need).toFixed(2)})`;
}

export function useStorefront(): StorefrontSet {
  const { mode, tokens: brand } = useAppTheme();
  const theme = useTheme();
  const backdrop = brand.brand?.background;
  const onPhoto = backdrop?.kind === 'image' && Boolean(backdrop.imageUrl);
  const primary = theme.palette.text.primary;
  const accent = theme.palette.secondary?.main;
  const style = theme.palette.brand?.surfaceStyle ?? 'flat';
  const paper = theme.palette.background.paper;
  const page = theme.palette.background.default;
  const secondary = theme.palette.text.secondary;

  return useMemo(() => {
    const plain = storefrontTokens(mode);
    const texts = [primary, secondary];
    const base: StorefrontTokens = onPhoto
      ? {
          ...plain,
          glass: {
            ...plain.glass,
            bar: { ...plain.glass.bar, background: densify(plain.glass.bar.background, texts) },
            sheet: { ...plain.glass.sheet, background: densify(plain.glass.sheet.background, texts) },
            panel: { ...plain.glass.panel, background: densify(plain.glass.panel.background, texts) },
            nav: { ...plain.glass.nav, background: densify(plain.glass.nav.background, texts) },
          },
        }
      : plain;
    const surface = cardSurface(style, mode);
    const room = roomControlAccent(accent, mode);
    // Фон под буквами пилюли: её подложка поверх страницы и поверх карточки.
    const pillGrounds = [paper, page].map((under) => overlayColor(base.roomControl.statusPillBackground, under));
    return {
      ...base,
      roomControl: {
        ...base.roomControl,
        accent: room.accent,
        accentContrast: room.accentContrast,
        accentSoft: room.accentSoft,
        accentGlow: room.accentGlow,
      },
      cardSurface:
        onPhoto && style === 'glass' ? { ...surface, background: densify(surface.background, texts) } : surface,
      roomAccentIsSpare: room.fallback,
      roomText: {
        accent: readable(room.accent, pillGrounds, mode, TEXT_CONTRAST + TEXT_MARGIN),
        cold: readable(base.roomControl.cold, pillGrounds, mode, TEXT_CONTRAST + TEXT_MARGIN),
        neutral: readable(secondary, pillGrounds, mode, TEXT_CONTRAST + TEXT_MARGIN),
      },
    };
  }, [mode, accent, style, paper, page, secondary, primary, onPhoto]);
}
