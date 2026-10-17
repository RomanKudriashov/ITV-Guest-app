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
export function imageSetCss(ref: ImageRef, cssWidth: number): string {
  const one = pickWidth(ref, Math.ceil(cssWidth));
  const two = pickWidth(ref, Math.ceil(cssWidth * 2));
  if (!one || !two) return 'none';
  if (one.url === two.url) return `image-set(url("${one.url}") 1x)`;
  return `image-set(url("${one.url}") 1x, url("${two.url}") 2x)`;
}

/**
 * Фон для `sx`: сначала простой `url()` (браузер без `image-set` возьмёт его),
 * потом `image-set` — emotion выводит массив значений запасными объявлениями.
 */
export function backgroundImageSx(ref: ImageRef, cssWidth: number): { backgroundImage: string[] } {
  const fallback = pickWidth(ref, Math.ceil(cssWidth * 2))?.url ?? ref.src;
  return { backgroundImage: [`url("${fallback}")`, imageSetCss(ref, cssWidth)] };
}
