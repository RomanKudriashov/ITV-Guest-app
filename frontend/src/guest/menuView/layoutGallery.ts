/**
 * РАСКЛАДКА МОЗАИКИ (партия 57) — плитки без дыр, ряды во всю ширину.
 *
 * Два размера: большая `l` (2×2 клетки) и мелкая `s` (1×1). Блоки идут по
 * очереди:
 *   • «акцент» — большая + мелкие в оставшихся (cols−2)×2 клетках; сторона
 *     большой чередуется (начало / конец ряда), чтобы мозаика не стала
 *     столбцом. В RTL сетка сама зеркалит колонки — сторона меняется зеркально;
 *   • «ряд» — cols мелких.
 * На двух колонках большая занимает всю ширину — акцент из одной плитки.
 *
 * Хвост, которому не хватает на целый блок, ложится последним рядом и
 * растягивается по ширине поровну (остаток — первым): пустых клеток нет ни при
 * каком числе позиций. Тот же набор → та же мозаика: вёрстка не прыгает между
 * рендерами.
 *
 * ПРЕДЕЛ ФОРМЫ ХВОСТА ~3:1 (партия 58б). Одна позиция хвоста на 4 колонки
 * была полосой 1032×189 (5,5:1) — фото резалось до 12–27 %. Плитка хвоста шире
 * `TAIL_MAX_RATIO` растёт в высоту на второй ряд: она во всю ширину, и дыр это
 * не даёт. Одна позиция на 4 колонки — 4×2 (≈2,6:1), на 3 — 3×2 (≈2:1).
 *
 * КТО КРУПНО. Позиции с отметкой «крупно в мозаике» встают на места больших
 * по порядку; остальные места больших — по месту в списке. Нет отметок —
 * раскладка ровно как у образца: большая — та, что по счёту попала на место.
 * Отметок больше, чем мест, — лишние идут мелкими после неотмеченных.
 */

export type TileSize = 'l' | 's' | 'wide';

export interface PlacedTile<T> {
  item: T;
  /** Колонка и ряд CSS-сетки, с 1. */
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  size: TileSize;
}

/** Высота клетки к её ширине — как `ROW_RATIO` в `MenuMosaic`. */
export const CELL_RATIO = 0.75;
/** Предел формы плитки хвоста: шире — растёт на ряд вниз (партия 58б). */
export const TAIL_MAX_RATIO = 3;

/** Сколько рядов нужно плитке шириной `span` клеток, чтобы не быть шире предела. */
export function tailRowSpan(span: number): number {
  return Math.max(1, Math.ceil(span / (TAIL_MAX_RATIO * CELL_RATIO)));
}

export function layoutGallery<T>(
  items: readonly T[],
  cols: number,
  isLarge: (item: T) => boolean = () => false,
): PlacedTile<T>[] {
  const columns = Math.max(1, Math.floor(cols));
  // Две очереди: отмеченные — на места больших, прочие — на мелкие. Пустеет
  // своя очередь — берём из другой, так что позиция не теряется никогда.
  const marked = items.filter((item) => isLarge(item));
  const plain = items.filter((item) => !isLarge(item));
  let m = 0;
  let p = 0;
  const takeLarge = (): T => (m < marked.length ? marked[m++] : plain[p++]);
  const takeSmall = (): T => (p < plain.length ? plain[p++] : marked[m++]);
  const left = () => marked.length - m + plain.length - p;

  const out: PlacedTile<T>[] = [];
  let row = 1;
  let featureAtStart = true;
  let nextIsFeature = true;
  // Одна колонка — большой плитке негде стать 2×2: только ряды.
  const canFeature = columns >= 2;
  const smallsInFeature = columns <= 2 ? 0 : 2 * (columns - 2);

  const place = (item: T, col: number, r: number, colSpan: number, rowSpan: number, size: TileSize) =>
    out.push({ item, col, row: r, colSpan, rowSpan, size });

  // Хвост: n (< блока) плиток одним рядом, ширина поровну, остаток — первым.
  // Первая плитка хвоста — с места большой, если ей положено быть крупной.
  const tailRow = (n: number, feature: boolean) => {
    const base = Math.floor(columns / n);
    let extra = columns % n;
    let col = 1;
    // Высота хвоста — одна на весь ряд: по самой широкой плитке. Иначе рядом с
    // плиткой в два ряда осталась бы дыра.
    const rows = tailRowSpan(base + (extra > 0 ? 1 : 0));
    for (let k = 0; k < n; k += 1) {
      const span = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra -= 1;
      const item = feature && k === 0 ? takeLarge() : takeSmall();
      place(item, col, row, span, rows, span >= 2 ? 'wide' : 's');
      col += span;
    }
    row += rows;
  };

  while (left() > 0) {
    const remaining = left();
    if (nextIsFeature && canFeature) {
      const need = 1 + smallsInFeature;
      if (remaining < need) {
        tailRow(Math.min(remaining, columns), true);
        continue;
      }
      const lCol = columns <= 2 ? 1 : featureAtStart ? 1 : columns - 1;
      place(takeLarge(), lCol, row, 2, 2, 'l');
      if (smallsInFeature) {
        const free: number[] = [];
        for (let c = 1; c <= columns; c += 1) if (c < lCol || c > lCol + 1) free.push(c);
        for (let r = 0; r < 2; r += 1) {
          for (const c of free) place(takeSmall(), c, row + r, 1, 1, 's');
        }
      }
      row += 2;
      featureAtStart = !featureAtStart;
      nextIsFeature = false;
    } else {
      if (remaining < columns) {
        tailRow(remaining, false);
        continue;
      }
      for (let c = 1; c <= columns; c += 1) place(takeSmall(), c, row, 1, 1, 's');
      row += 1;
      nextIsFeature = true;
    }
  }
  return out;
}

/** Колонки мозаики по ширине окна: 4 от 1024, 2 на телефоне, между — 3. */
export function mosaicColumns(viewportWidth: number): number {
  if (viewportWidth >= 1024) return 4;
  if (viewportWidth >= 600) return 3;
  return 2;
}
