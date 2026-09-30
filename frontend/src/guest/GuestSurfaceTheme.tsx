import { useCallback, type ReactNode } from 'react';
import { ThemeProvider, type Theme } from '@mui/material/styles';

import { cardSurfaceCss } from './storefrontTokens';
import { useStorefront } from './useStorefront';

/**
 * КАРТОЧКИ ВИТРИНЫ НА `Paper` — СТИЛЕМ ПОВЕРХНОСТИ ОТЕЛЯ (партия 25).
 *
 * Корзина, заказы, статус заказа, отзывы, выбор места нарисованы
 * `Paper variant="outlined"`, а тема приложения такую бумагу стилем поверхности
 * не красит — намеренно: ею же сделаны формы и таблицы панели. Слой темы здесь
 * живёт только внутри витрины (и её показа), поэтому панель он не трогает.
 */
export function GuestSurfaceTheme({ children }: { children: ReactNode }) {
  const { cardSurface } = useStorefront();
  const withCards = useCallback(
    (outer: Theme): Theme => ({
      ...outer,
      components: {
        ...outer.components,
        MuiPaper: {
          ...outer.components?.MuiPaper,
          variants: [
            ...(outer.components?.MuiPaper?.variants ?? []),
            { props: { variant: 'outlined' }, style: cardSurfaceCss(cardSurface, outer) },
          ],
        },
      },
    }),
    [cardSurface],
  );
  return <ThemeProvider theme={withCards}>{children}</ThemeProvider>;
}
