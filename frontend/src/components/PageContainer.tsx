import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';

/**
 * КОНТЕЙНЕР СТРАНИЦЫ ПАНЕЛИ — ОТСТУП 24 px ОТ МЕНЮ И ОТ КРАЁВ (партия 55).
 *
 * Отступ задавал каждый экран сам, и аудит насчитал девять разных: 6, 8, 12,
 * 0, 140, 210 вместо 24. Теперь он один и задаётся здесь; экран отвечает
 * только за то, что внутри. Ширина — во всю область: узкая колонка по центру
 * (справочники) на широком экране оставляла пустыми две трети.
 */
export function PageContainer({ children, testId, sx }: { children: ReactNode; testId?: string; sx?: SxProps<Theme> }) {
  return (
    <Box data-testid={testId} sx={[{ p: 3, minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {children}
    </Box>
  );
}
