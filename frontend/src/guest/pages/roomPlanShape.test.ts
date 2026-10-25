import { describe, expect, it } from 'vitest';

import { planShape } from './roomPlanShape';

describe('planShape — раскладка страницы номера по форме плана (64-1)', () => {
  it('«Сиалия» 202 и 204 — широкие', () => {
    expect(planShape(2.5423)).toBe('wide');
    expect(planShape(2.1038)).toBe('wide');
  });

  it('«Кристалл» 305 и тип 3 — квадратные, раскладка прежняя', () => {
    expect(planShape(1.056)).toBe('square');
    expect(planShape(1.5988)).toBe('square');
  });

  it('вертикальный план — tall', () => {
    expect(planShape(0.393)).toBe('tall');
    expect(planShape(0.8)).toBe('tall');
  });

  it('без плана или с мусором — квадратная, то есть прежняя', () => {
    expect(planShape(null)).toBe('square');
    expect(planShape(undefined)).toBe('square');
    expect(planShape(Number.NaN)).toBe('square');
  });
});
