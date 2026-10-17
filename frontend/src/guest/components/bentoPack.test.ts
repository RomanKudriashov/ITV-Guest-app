import { describe, expect, it } from 'vitest';

import { packBento, tileRatio, type BentoSize, type BentoShape } from './bentoPack';

/**
 * ФОРМА ПЛИТОК ГЛАВНОЙ (партия 58б). Замер 58а: одинокая «Инфо» в последнем
 * ряду растягивалась на 4 колонки — 1032×150 (6,9:1). Предел ~3:1, ряд
 * добирается ростом плиток сверху, дыр нет.
 */
const DESKTOP: BentoShape = { cell: 247.5 / 170, gap: 14 / 170, maxRatio: 3 };
const PHONE: BentoShape = { cell: 174 / 128, gap: 10 / 128, maxRatio: 3 };

const tiles = (sizes: BentoSize[]) => sizes.map((size, i) => ({ size, key: `t${i}` }));

function filled(placed: ReturnType<typeof packBento>, cols: number): boolean {
  const rows = placed.reduce((m, p) => Math.max(m, p.rowStart - 1 + p.rowSpan), 0);
  const seen = new Set<string>();
  for (const p of placed)
    for (let r = p.rowStart; r < p.rowStart + p.rowSpan; r += 1)
      for (let c = p.colStart; c < p.colStart + p.colSpan; c += 1) {
        const k = `${r}:${c}`;
        if (seen.has(k)) return false;
        seen.add(k);
      }
  return seen.size === rows * cols;
}

const MIXES: BentoSize[][] = [
  ['l', 'm', 's', 's', 's'],
  ['l', 's', 's', 's', 's', 's'],
  ['m', 'm', 'm', 's'],
  ['l', 'l', 's'],
  ['s'],
  ['m', 's', 's', 's', 's', 's', 's'],
  ['l', 'm', 'm', 's', 's', 's', 's', 's'],
];

describe('packBento — предел формы', () => {
  it.each([
    [4, DESKTOP],
    [2, PHONE],
  ] as const)('%i колонки: без дыр и ни одной плитки шире 3:1', (cols, shape) => {
    for (const mix of MIXES) {
      const placed = packBento(tiles(mix), cols, shape);
      expect(filled(placed, cols), mix.join('')).toBe(true);
      for (const p of placed) {
        expect(tileRatio(p.colSpan, p.rowSpan, shape), `${mix.join('')} ${p.tile.key} ${p.colSpan}×${p.rowSpan}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it('одинокая плитка последнего ряда не становится полосой во всю ширину', () => {
    // Витрина «Кристалла»: L, M, S, S + «Инфо» (S) последней.
    const placed = packBento(tiles(['l', 'm', 's', 's', 's']), 4, DESKTOP);
    const info = placed.find((p) => p.tile.key === 't4')!;
    expect(info.colSpan).toBeLessThan(4);
  });
});
