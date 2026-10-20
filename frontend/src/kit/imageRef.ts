/**
 * ОБЪЕКТ КАРТИНКИ (партия 58а) и расчёты вокруг него — без React, под юнит-тесты.
 *
 * Сервер отдаёт ряд ширин (не шире оригинала), форму кадра, фокус и средний
 * цвет (`apps/media/services/assets.py: image_ref`). Место показа выбирает файл
 * само — `srcset` + `sizes`, — а не получает card 600 на всё: замер 17.10 нашёл
 * растяжение ×6,3 в окне «House rules» и ×3,6 в шапках.
 */

export interface ImageWidth {
  w: number;
  url: string;
}

export interface ImageRef {
  /** Запасной адрес (средняя ширина) — для мест без srcset. */
  src: string;
  widths: ImageWidth[];
  /** Форма кадра, лежащего в файлах. */
  w: number | null;
  h: number | null;
  /** Точка фокуса, доли кадра 0..1. */
  focus: { x: number; y: number };
  /** Средний цвет `#rrggbb` — подложка и замена размытия. */
  color: string | null;
  luminance: number | null;
}

/** Ниже этой доли кадра место показывает фото целиком поверх размытого. */
export const MIN_VISIBLE_SHARE = 0.6;

/**
 * ПОТОЛОК ПЛОТНОСТИ — 2 (партия 61). Браузер берёт файл под ширину места ×
 * плотность экрана, и телефон с плотностью 3 качал в карточку 390 px файл 1200:
 * втрое тяжелее, а разницы с ×2 глазом не видно. Файлы не пережимаются —
 * выбирается ширина из того же ряда.
 */
export const MAX_DENSITY = 2;

/** Во сколько раз уменьшить «место» в `sizes`, чтобы плотность выше 2 не брала шире ×2. */
export function densityCap(dpr: number = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1): number {
  return dpr > MAX_DENSITY ? MAX_DENSITY / dpr : 1;
}

/**
 * `sizes` с потолком плотности: каждое значение места умножается на
 * `densityCap`. «(min-width: 1024px) 400px, 100vw» на плотности 3 →
 * «(min-width: 1024px) calc(400px * 0.6667), calc(100vw * 0.6667)».
 */
export function cappedSizes(sizes: string, cap: number = densityCap()): string {
  if (cap >= 1) return sizes;
  const k = cap.toFixed(4);
  return sizes
    .split(',')
    .map((entry) => {
      const trimmed = entry.trim();
      const cut = trimmed.lastIndexOf(' ');
      const media = cut > 0 && trimmed.startsWith('(') ? trimmed.slice(0, cut) : '';
      const length = media ? trimmed.slice(cut + 1) : trimmed;
      return `${media ? `${media} ` : ''}calc(${length} * ${k})`;
    })
    .join(', ');
}

/**
 * ПОТОЛОК ШИРИНЫ ФОНА — 2400 (партия 61). Фон бренда лежит под вуалью и
 * тонировкой страницы; на телефоне `cover` по высоте экрана × 2 просил 3840
 * (808 КБ) — без видимой разницы с 2400 под вуалью.
 */
export const MAX_BACKGROUND_WIDTH = 2400;

export function srcSetOf(ref: ImageRef): string {
  return ref.widths.map((x) => `${x.url} ${x.w}w`).join(', ');
}

/** `object-position` по фокусу. */
export function focusPosition(ref: ImageRef): string {
  const pct = (v: number) => `${Math.round(Math.min(Math.max(v, 0), 1) * 1000) / 10}%`;
  return `${pct(ref.focus?.x ?? 0.5)} ${pct(ref.focus?.y ?? 0.5)}`;
}

/** Наименьшая ширина не уже `px`; нет такой — самая широкая. */
export function pickWidth(ref: ImageRef, px: number): ImageWidth | null {
  if (!ref.widths.length) return null;
  return ref.widths.find((x) => x.w >= px) ?? ref.widths[ref.widths.length - 1];
}

/**
 * Какая доля кадра видна в месте `boxW×boxH` при `object-fit: cover`.
 * Нет формы кадра или места — считаем, что видно всё (резать не о чем судить).
 */
export function visibleShare(ref: Pick<ImageRef, 'w' | 'h'>, boxW: number, boxH: number): number {
  if (!ref.w || !ref.h || boxW <= 0 || boxH <= 0) return 1;
  const box = boxW / boxH;
  const frame = ref.w / ref.h;
  return Math.min(box / frame, frame / box);
}

/** Ширина файла, нужная `cover`-месту `boxW×boxH` (CSS px): по оси, которой не хватает. */
export function coverWidth(ref: Pick<ImageRef, 'w' | 'h'>, boxW: number, boxH: number): number {
  if (!ref.w || !ref.h) return boxW;
  return Math.max(boxW, boxH * (ref.w / ref.h));
}

/**
 * Фон через `image-set`: 1x и 2x под ширину места в CSS px. Браузер берёт
 * свою плотность сам; ряд ширин тот же, что у `srcset`.
 */
export function imageSetCss(ref: ImageRef, cssWidth: number, maxWidth = Infinity): string {
  const one = pickWidth(ref, Math.min(Math.ceil(cssWidth), maxWidth));
  const two = pickWidth(ref, Math.min(Math.ceil(cssWidth * 2), maxWidth));
  if (!one || !two) return 'none';
  if (one.url === two.url) return `image-set(url("${one.url}") 1x)`;
  return `image-set(url("${one.url}") 1x, url("${two.url}") 2x)`;
}

/**
 * Фон для `sx`: простой `url()` (браузер без `image-set` возьмёт его), а
 * `image-set` — под `@supports`.
 *
 * НЕ МАССИВОМ. `sx` читает массив как значения по брейкпойнтам: `[url, set]`
 * давал `url` до 600 px и `image-set` шире — телефон с DPR 1 качал файл под 2x
 * (замер 17.10: фон 390×844 брал 3200 вместо 2400).
 */
export const IMAGE_SET_SUPPORTS = '@supports (background-image: image-set(url("x.webp") 1x))';

export function backgroundImageSx(
  ref: ImageRef,
  cssWidth: number,
  maxWidth = Infinity,
): { backgroundImage: string; [IMAGE_SET_SUPPORTS]: { backgroundImage: string } } {
  const fallback = pickWidth(ref, Math.min(Math.ceil(cssWidth * 2), maxWidth))?.url ?? ref.src;
  return {
    backgroundImage: `url("${fallback}")`,
    [IMAGE_SET_SUPPORTS]: { backgroundImage: imageSetCss(ref, cssWidth, maxWidth) },
  };
}
