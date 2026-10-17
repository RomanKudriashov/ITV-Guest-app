/**
 * Bento packing: place variably-sized tiles (S 1×1, M 2×1, L 2×2) into a grid of
 * `cols` columns with NO holes and NO orphan tiles.
 *
 * The showcase must never show a gap or a lone tile dangling on its own row (the
 * bug the redesign fixes). We place greedily (first-fit, dense), then absorb any
 * leftover empty cell into an adjacent tile — so whatever size mix the server or
 * the CMS produces, the result tiles the rectangle completely.
 */

export type BentoSize = 's' | 'm' | 'l';

export interface Placed<T> {
  tile: T;
  colStart: number; // 1-based, for CSS grid-column
  rowStart: number; // 1-based, for CSS grid-row
  colSpan: number;
  rowSpan: number;
}

const FOOTPRINT: Record<BentoSize, [number, number]> = {
  s: [1, 1],
  m: [2, 1],
  l: [2, 2],
};

/**
 * ФОРМА КЛЕТКИ И ПРЕДЕЛ ФОРМЫ ПЛИТКИ (партия 58б).
 *
 * Дыры раньше закрывались расширением соседа слева: одинокая плитка «Инфо» в
 * последнем ряду растягивалась на 4 колонки — полоса 1032×150 (6,9:1), фото
 * резалось до 26 %. Теперь у кандидатов (слева, сверху, справа) считается
 * форма после роста, и берётся первый, кто не шире `maxRatio`; не уложился
 * никто — тот, у кого форма ближе к пределу. Ряд добирается ростом плиток
 * сверху вниз, а не полосой.
 */
export interface BentoShape {
  /** Ширина колонки к высоте ряда. */
  cell: number;
  /** Зазор к высоте ряда. */
  gap: number;
  /** Предел формы ширина:высота. */
  maxRatio: number;
}

export function tileRatio(colSpan: number, rowSpan: number, shape: BentoShape): number {
  return (colSpan * shape.cell + (colSpan - 1) * shape.gap) / (rowSpan + (rowSpan - 1) * shape.gap);
}

export function packBento<T extends { size: BentoSize }>(
  tiles: T[],
  cols: number,
  shape: BentoShape | null = null,
): Placed<T>[] {
  const grid: boolean[][] = [];
  const ensureRow = (r: number) => {
    while (grid.length <= r) grid.push(new Array(cols).fill(false));
  };
  const free = (r: number, c: number, w: number, h: number): boolean => {
    if (c < 0 || c + w > cols) return false;
    ensureRow(r + h - 1);
    for (let rr = r; rr < r + h; rr += 1) for (let cc = c; cc < c + w; cc += 1) if (grid[rr][cc]) return false;
    return true;
  };
  const occupy = (r: number, c: number, w: number, h: number) => {
    ensureRow(r + h - 1);
    for (let rr = r; rr < r + h; rr += 1) for (let cc = c; cc < c + w; cc += 1) grid[rr][cc] = true;
  };

  const placed: Placed<T>[] = [];
  for (const tile of tiles) {
    let [w, h] = FOOTPRINT[tile.size] ?? [1, 1];
    w = Math.min(w, cols);
    let done = false;
    for (let r = 0; !done; r += 1) {
      ensureRow(r);
      for (let c = 0; c < cols && !done; c += 1) {
        if (free(r, c, w, h)) {
          occupy(r, c, w, h);
          placed.push({ tile, colStart: c + 1, rowStart: r + 1, colSpan: w, rowSpan: h });
          done = true;
        }
      }
      // Safety valve — cannot loop forever on a malformed footprint.
      if (!done && r > tiles.length * 3 + 6) {
        const nr = grid.length;
        occupy(nr, 0, w, h);
        placed.push({ tile, colStart: 1, rowStart: nr + 1, colSpan: w, rowSpan: h });
        done = true;
      }
    }
  }

  absorbHoles(placed, cols, shape);
  if (shape) growFullRows(placed, cols, shape);
  return placed;
}

/** Find the placed tile occupying cell (r,c), 0-based. */
function at<T>(placed: Placed<T>[], r: number, c: number): Placed<T> | undefined {
  return placed.find(
    (p) =>
      r >= p.rowStart - 1 &&
      r < p.rowStart - 1 + p.rowSpan &&
      c >= p.colStart - 1 &&
      c < p.colStart - 1 + p.colSpan,
  );
}

/**
 * Grow neighbouring tiles over every empty cell so the grid has no holes AND no
 * overlaps. A gap is absorbed by the tile to its left, above, or right — but only
 * if the WHOLE new footprint of that tile is empty (a tall tile spans several
 * rows, so widening it must not collide with a tile beside it on another row).
 */
function absorbHoles<T>(placed: Placed<T>[], cols: number, shape: BentoShape | null): void {
  const rectFree = (p: Placed<T>, colStart: number, colSpan: number, rowStart: number, rowSpan: number) => {
    for (let r = rowStart - 1; r < rowStart - 1 + rowSpan; r += 1) {
      for (let c = colStart - 1; c < colStart - 1 + colSpan; c += 1) {
        if (c < 0 || c >= cols) return false;
        const owner = at(placed, r, c);
        if (owner && owner !== p) return false; // occupied by someone else
      }
    }
    return true;
  };

  const rows = () => placed.reduce((m, p) => Math.max(m, p.rowStart - 1 + p.rowSpan), 0);

  for (let r = 0; r < rows(); r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (at(placed, r, c)) continue;

      // Кандидаты на дыру: сосед слева (шире), сверху (выше), справа (шире).
      type Grow = { tile: Placed<T>; apply: () => void; ratio: number };
      const options: Grow[] = [];
      const left = c > 0 ? at(placed, r, c - 1) : undefined;
      if (left && left.colStart - 1 + left.colSpan === c && rectFree(left, c + 1, 1, left.rowStart, left.rowSpan)) {
        const tile = left;
        options.push({ tile, apply: () => { tile.colSpan += 1; }, ratio: shape ? tileRatio(tile.colSpan + 1, tile.rowSpan, shape) : 0 });
      }
      const above = r > 0 ? at(placed, r - 1, c) : undefined;
      if (above && above.rowStart - 1 + above.rowSpan === r && rectFree(above, above.colStart, above.colSpan, r + 1, 1)) {
        const tile = above;
        options.push({ tile, apply: () => { tile.rowSpan += 1; }, ratio: shape ? tileRatio(tile.colSpan, tile.rowSpan + 1, shape) : 0 });
      }
      const right = c + 1 < cols ? at(placed, r, c + 1) : undefined;
      if (right && right.colStart - 1 === c + 1 && rectFree(right, c + 1, 1, right.rowStart, right.rowSpan)) {
        const tile = right;
        options.push({ tile, apply: () => { tile.colStart -= 1; tile.colSpan += 1; }, ratio: shape ? tileRatio(tile.colSpan + 1, tile.rowSpan, shape) : 0 });
      }
      if (!options.length) continue;
      const fits = shape ? options.find((o) => o.ratio <= shape.maxRatio) : options[0];
      (fits ?? options.reduce((a, b) => (b.ratio < a.ratio ? b : a))).apply();
    }
  }
}

/**
 * Плитка во всю ширину, которой не нашлось соседа сверху (одна-единственная
 * на витрине, первый ряд), растёт в высоту до предела формы. Она во всю
 * ширину — дыр это не даёт; ряды ниже сдвигаются.
 */
function growFullRows<T>(placed: Placed<T>[], cols: number, shape: BentoShape): void {
  for (const p of [...placed].sort((a, b) => a.rowStart - b.rowStart)) {
    if (p.colSpan !== cols) continue;
    let extra = 0;
    while (tileRatio(p.colSpan, p.rowSpan + extra, shape) > shape.maxRatio) extra += 1;
    if (!extra) continue;
    const bottom = p.rowStart + p.rowSpan;
    for (const q of placed) if (q !== p && q.rowStart >= bottom) q.rowStart += extra;
    p.rowSpan += extra;
  }
}
