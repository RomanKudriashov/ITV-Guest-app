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
 *   * характер поверхности карточек берётся из выбранного стиля.
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
import {
  cardSurface,
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
}

export function useStorefront(): StorefrontSet {
  const { mode } = useAppTheme();
  const theme = useTheme();
  const accent = theme.palette.secondary?.main;
  const style = theme.palette.brand?.surfaceStyle ?? 'flat';

  return useMemo(() => {
    const base = storefrontTokens(mode);
    const room = roomControlAccent(accent, mode);
    return {
      ...base,
      roomControl: {
        ...base.roomControl,
        accent: room.accent,
        accentContrast: room.accentContrast,
        accentSoft: room.accentSoft,
        accentGlow: room.accentGlow,
      },
      cardSurface: cardSurface(style, mode),
      roomAccentIsSpare: room.fallback,
    };
  }, [mode, accent, style]);
}
