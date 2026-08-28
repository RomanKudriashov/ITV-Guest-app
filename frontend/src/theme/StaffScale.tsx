import { useMemo, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import { ThemeProvider, useTheme } from '@mui/material/styles';

import { compactTheme, density } from '@/theme/density';

/**
 * Область персонала: та же тема бренда, но по компактной шкале.
 *
 * Оболочка отдельная, потому что тему делит ГОСТЬ — она поднята один раз в
 * `main.tsx`. У гостя крупное оправдано: телефон, одна рука, приложение
 * впервые в жизни. Здесь же сидят за работой, и плотность важнее.
 */
export function StaffScale({ children }: { children: ReactNode }) {
  const base = useTheme();
  const theme = useMemo(() => compactTheme(base), [base]);
  return (
    <ThemeProvider theme={theme}>
      {/*
        Опора шкалы задаётся и НАСЛЕДОВАНИЕМ тоже. Варианты MUI покрывают
        текст, у которого вариант есть; всё остальное наследует размер от
        `body`, а он у корня документа общий с гостем — 18.29px. Без этой
        строки половина надписей оставалась бы крупной, и разъезд начался бы
        снова, только незаметнее.
      */}
      <Box sx={{ fontSize: density.font.body, display: 'contents' }}>{children}</Box>
    </ThemeProvider>
  );
}
