import { darken, decomposeColor, getContrastRatio, lighten, recomposeColor } from '@mui/material/styles';

/**
 * НИЖНЯЯ ПЛАНКА КОНТРАСТА — ОТ ЛЮБОГО БРЕНДА (партия 55).
 *
 * Цвета приходят из пресета отеля, и отель волен выбрать серый потише или
 * акцент посветлее. Правка «этого» отеля ничего не решает: следующий выберет
 * свой. Поэтому тема сама доводит цвет текста до читаемого — против ВСЕХ
 * фонов, на которых он лежит (страница, поверхность, приглушённая и
 * выбранная), — сдвигая его к тёмному в светлой теме и к светлому в тёмной.
 * Цвет, который уже читается, остаётся как есть: бренд не перекрашивается.
 *
 * 4.5 — WCAG AA для обычного текста. Шаг 4 % — мелкий, чтобы сдвиг был
 * минимальным: аудит партии 55 видел 3.81 и 4.12 у вторичного текста.
 */
export const TEXT_CONTRAST = 4.5;

export function readable(
  color: string,
  backgrounds: ReadonlyArray<string>,
  mode: 'light' | 'dark',
  target: number = TEXT_CONTRAST,
): string {
  const passes = (candidate: string) => backgrounds.every((bg) => getContrastRatio(candidate, bg) >= target);
  if (passes(color)) return color;
  for (let step = 1; step <= 25; step++) {
    const candidate = mode === 'dark' ? lighten(color, step * 0.04) : darken(color, step * 0.04);
    if (passes(candidate)) return candidate;
  }
  return mode === 'dark' ? lighten(color, 1) : darken(color, 1);
}

/** Сплошное смешение двух цветов: `t` — доля второго. Без прозрачности: прозрачный текст меряется по фону, который не известен. */
export function mix(a: string, b: string, t: number): string {
  const x = decomposeColor(a).values;
  const y = decomposeColor(b).values;
  const values = [0, 1, 2].map((i) => Math.round(x[i] * (1 - t) + y[i] * t)) as [number, number, number];
  return recomposeColor({ type: 'rgb', values });
}
