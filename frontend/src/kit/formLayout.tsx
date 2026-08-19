import type { ReactNode } from 'react';
import Box from '@mui/material/Box';

/**
 * РАСКЛАДКА ФОРМЫ — ОБЩАЯ ДЛЯ КОНСОЛИ И CMS, БЕЗ ЕДИНОГО ЦВЕТА.
 *
 * Формы обоих продуктов страдали одним и тем же: ширина поля назначалась по
 * месту — `minWidth: 160`, `sx={{ width: 120 }}`, `flexGrow: 1` — и ряд
 * `flex-wrap` перескакивал по одному полю, оставляя лестницу. В «Новом отеле»
 * это давало пять разных ширин в одном столбце, в диалоге сотрудника — три.
 *
 * Здесь ширина выражается ЕДИНСТВЕННЫМ способом: сколько колонок из двенадцати
 * занимает ячейка. Переносы становятся предсказуемыми (12 колонок делятся
 * нацело), а на узком экране всё честно схлопывается в одну колонку.
 *
 * Цвета тут нет намеренно: консоль одевает поля своим словарём, CMS — темой
 * отеля, и общей у них должна быть раскладка, а не палитра.
 */

export type FormSpan = 2 | 3 | 4 | 6 | 8 | 9 | 12;

/** Сколько колонок занимает ячейка. На узком экране — всегда вся строка. */
export function spanSx(columns: FormSpan) {
  return { gridColumn: { xs: 'span 12', sm: `span ${columns}` } } as const;
}

export const formGridSx = {
  display: 'grid',
  gridTemplateColumns: 'repeat(12, 1fr)',
  columnGap: 2,
  rowGap: 2.25,
  alignItems: 'start',
} as const;

/** Сетка формы. Всё внутри объявляет ширину в колонках. */
export function FormGrid({ children }: { children: ReactNode }) {
  return <Box sx={formGridSx}>{children}</Box>;
}

/** Ячейка сетки под что угодно: набор пилюль, переключатели, кнопку. */
export function FormCell({
  span = 12,
  children,
}: {
  span?: FormSpan;
  children: ReactNode;
}) {
  return <Box sx={spanSx(span)}>{children}</Box>;
}
