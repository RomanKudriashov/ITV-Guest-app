import { describe, expect, it } from 'vitest';

import { layoutGallery, mosaicColumns, type PlacedTile } from './layoutGallery';

interface Dish {
  id: string;
  large?: boolean;
}

const dishes = (n: number, large: number[] = []): Dish[] =>
  Array.from({ length: n }, (_, i) => ({ id: `d${i}`, large: large.includes(i) }));

const isLarge = (d: Dish) => Boolean(d.large);

/** Карта занятых клеток: каждая ровно одной плиткой, без дыр до последнего ряда. */
function cells(placed: PlacedTile<Dish>[], cols: number) {
  const grid = new Map<string, string>();
  let rows = 0;
  for (const p of placed) {
    for (let r = p.row; r < p.row + p.rowSpan; r += 1) {
      for (let c = p.col; c < p.col + p.colSpan; c += 1) {
        const key = `${r}:${c}`;
        expect(grid.has(key), `клетка ${key} занята дважды`).toBe(false);
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c).toBeLessThanOrEqual(cols);
        grid.set(key, p.item.id);
        rows = Math.max(rows, r);
      }
    }
  }
  return { grid, rows };
}

describe('layoutGallery', () => {
  it.each([2, 3, 4])('без дыр и без потерь на %i колонках при любом числе позиций', (cols) => {
    for (let n = 0; n <= 40; n += 1) {
      const placed = layoutGallery(dishes(n), cols, isLarge);
      expect(placed).toHaveLength(n);
      expect(new Set(placed.map((p) => p.item.id)).size).toBe(n);
      const { grid, rows } = cells(placed, cols);
      // Хвост растянут — все ряды заполнены целиком.
      expect(grid.size).toBe(rows * cols);
    }
  });

  it('детерминирована: тот же набор — та же мозаика', () => {
    const items = dishes(17, [3, 9]);
    expect(layoutGallery(items, 4, isLarge)).toEqual(layoutGallery(items, 4, isLarge));
    expect(layoutGallery(items, 2, isLarge)).toEqual(layoutGallery(items, 2, isLarge));
  });

  it('4 колонки: акцент 2×2 + 4 мелких, затем ряд из 4, большая меняет сторону', () => {
    const placed = layoutGallery(dishes(18), 4, isLarge);
    const big = placed.filter((p) => p.size === 'l');
    expect(big.map((p) => [p.item.id, p.col, p.row, p.colSpan, p.rowSpan])).toEqual([
      ['d0', 1, 1, 2, 2],
      ['d9', 3, 4, 2, 2],
    ]);
    // Ряд мелких после акцента — 4 в ряд 3.
    expect(placed.filter((p) => p.row === 3).map((p) => p.item.id)).toEqual(['d5', 'd6', 'd7', 'd8']);
  });

  it('2 колонки: большая во всю ширину, затем ряд из двух', () => {
    const placed = layoutGallery(dishes(6), 2, isLarge);
    expect(placed.map((p) => [p.item.id, p.col, p.row, p.colSpan, p.rowSpan, p.size])).toEqual([
      ['d0', 1, 1, 2, 2, 'l'],
      ['d1', 1, 3, 1, 1, 's'],
      ['d2', 2, 3, 1, 1, 's'],
      ['d3', 1, 4, 2, 2, 'l'],
      ['d4', 1, 6, 1, 1, 's'],
      ['d5', 2, 6, 1, 1, 's'],
    ]);
  });

  it('хвост растягивается по ширине, остаток — первым', () => {
    // 5 (акцент) + 4 (ряд) + 3 — на акцент не хватает: ряд 2+1+1.
    const placed = layoutGallery(dishes(12), 4, isLarge);
    const tail = placed.filter((p) => p.row === 4);
    expect(tail.map((p) => [p.col, p.colSpan, p.size])).toEqual([
      [1, 2, 'wide'],
      [3, 1, 's'],
      [4, 1, 's'],
    ]);
  });

  it('отмеченные «крупно» встают на места больших по порядку', () => {
    const items = dishes(18, [7, 12]);
    const big = layoutGallery(items, 4, isLarge).filter((p) => p.size === 'l');
    expect(big.map((p) => p.item.id)).toEqual(['d7', 'd12']);
    // На двух колонках — то же правило.
    const big2 = layoutGallery(items, 2, isLarge).filter((p) => p.size === 'l');
    expect(big2.slice(0, 2).map((p) => p.item.id)).toEqual(['d7', 'd12']);
    // Отметки кончились — дальше большие по месту в списке: d0–d3 уже легли
    // мелкими в ряды после двух акцентов, следующая по порядку — d4.
    expect(big2[2].item.id).toBe('d4');
  });

  it('мелкие сохраняют порядок списка без отмеченных', () => {
    const items = dishes(10, [2]);
    const placed = layoutGallery(items, 4, isLarge);
    const smalls = placed.filter((p) => p.size !== 'l').map((p) => p.item.id);
    expect(smalls).toEqual(['d0', 'd1', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9']);
  });

  it('отметок больше, чем мест, — лишние идут мелкими, никто не теряется', () => {
    const items = dishes(6, [0, 1, 2, 3, 4, 5]);
    const placed = layoutGallery(items, 4, isLarge);
    expect(placed).toHaveLength(6);
    expect(placed.filter((p) => p.size === 'l')).toHaveLength(1);
  });

  it('колонки по ширине: 4 от 1024, 2 на телефоне', () => {
    expect(mosaicColumns(1440)).toBe(4);
    expect(mosaicColumns(1024)).toBe(4);
    expect(mosaicColumns(800)).toBe(3);
    expect(mosaicColumns(390)).toBe(2);
  });
});
