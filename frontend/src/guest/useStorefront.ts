/**
 * Набор витрины для активного режима.
 *
 * Хук, а не импорт констант: значения стекла и скримов зависят от темы, и
 * компонент, который берёт их напрямую, молча остаётся в одном режиме. Раньше
 * так и было — витрина импортировала плоские тёмные объекты, и светлая тема до
 * неё не доходила.
 */

import { useMemo } from 'react';

import { useAppTheme } from '@/theme';
import { storefrontTokens, type StorefrontTokens } from './storefrontTokens';

export function useStorefront(): StorefrontTokens {
  const { mode } = useAppTheme();
  return useMemo(() => storefrontTokens(mode), [mode]);
}
