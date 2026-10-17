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

/**
 * ПОДЛОЖКА ПОД ТЕКСТОМ НА ФОТО (партия 58б): одно затемнение на место.
 *
 * Минимальная плотность слоя `base`, при которой каждый цвет текста (со своей
 * прозрачностью) держит `target` к ЛЮБОМУ пикселю кадра — от чёрного до
 * белого, 17 ступеней, — плюс запас на округление и сглаживание края.
 */
const PLATE_STEP = 0.02;
const PLATE_MARGIN = 0.06;
const ANY_PIXEL: ReadonlyArray<[number, number, number]> = Array.from({ length: 17 }, (_, i) => {
  const v = Math.round((255 * i) / 16);
  return [v, v, v];
});

function rgbaParts(color: string): { rgb: [number, number, number]; a: number } {
  const parts = decomposeColor(color).values;
  return { rgb: [parts[0], parts[1], parts[2]], a: parts.length > 3 ? (parts[3] ?? 1) : 1 };
}

const over = (top: [number, number, number], a: number, under: [number, number, number]): [number, number, number] =>
  [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)) as [number, number, number];

const css = ([r, g, b]: [number, number, number]) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

export function photoPlateAlpha(base: string, texts: ReadonlyArray<string>, target: number = TEXT_CONTRAST): number {
  const plate = rgbaParts(base).rgb;
  const inks = texts.map(rgbaParts);
  for (let alpha = 0; alpha <= 1; alpha = Math.round((alpha + PLATE_STEP) * 100) / 100) {
    const ok = ANY_PIXEL.every((pixel) => {
      const seen = over(plate, alpha, pixel);
      return inks.every(({ rgb, a }) => getContrastRatio(css(over(rgb, a, seen)), css(seen)) >= target);
    });
    if (ok) return alpha;
  }
  return 1;
}

/** Цвет подложки `base` с плотностью из контраста текстов `texts` (+ запас). */
export function photoPlate(base: string, texts: ReadonlyArray<string>): string {
  const alpha = Math.min(1, photoPlateAlpha(base, texts) + PLATE_MARGIN);
  const [r, g, b] = rgbaParts(base).rgb.map(Math.round);
  return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
}

/**
 * Размытая подложка под блоком текста: `::before` шире блока на `spread`,
 * край размыт — внутри букв плотность полная, а плашки на кадре не видно.
 * Блоку нужен свой контекст наложения, чтобы подложка легла под буквы.
 */
export function photoPlateSx(color: string, spread = 40) {
  return {
    isolation: 'isolate',
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: `-${spread}px`,
      zIndex: -1,
      pointerEvents: 'none',
      background: color,
      filter: 'blur(14px)',
    },
  } as const;
}
