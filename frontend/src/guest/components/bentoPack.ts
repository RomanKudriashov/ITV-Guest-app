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

export function packBento<T extends { size: BentoSize }>(tiles: T[], cols: number): Placed<T>[] {
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

  absorbHoles(placed, cols);
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
function absorbHoles<T>(placed: Placed<T>[], cols: number): void {
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

      // Left neighbour ends at this column — widen it if its whole extended
      // column (across all its rows) is free.
      const left = c > 0 ? at(placed, r, c - 1) : undefined;
      if (left && left.colStart - 1 + left.colSpan === c && rectFree(left, c + 1, 1, left.rowStart, left.rowSpan)) {
        left.colSpan += 1;
        continue;
      }
      // Tile above ends at this row — extend it down if its whole extended row is free.
      const above = r > 0 ? at(placed, r - 1, c) : undefined;
      if (above && above.rowStart - 1 + above.rowSpan === r && rectFree(above, above.colStart, above.colSpan, r + 1, 1)) {
        above.rowSpan += 1;
        continue;
      }
      // Right neighbour starts just after the gap — pull it left over the gap.
      const right = c + 1 < cols ? at(placed, r, c + 1) : undefined;
      if (right && right.colStart - 1 === c + 1 && rectFree(right, c + 1, 1, right.rowStart, right.rowSpan)) {
        right.colStart -= 1;
        right.colSpan += 1;
        continue;
      }
    }
  }
}
