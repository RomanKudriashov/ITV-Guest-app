/**
 * Форма номера по пропорции кадра плана (ширина / высота) — партия 64-1.
 *
 * - `wide` — вытянут по горизонтали («Сиалия»: 2.1 и 2.5). На десктопе план во
 *   всю ширину, панели под ним.
 * - `square` — близок к квадрату («Кристалл»: 1.06 и 1.6). Две колонки, план
 *   слева, как было.
 * - `tall` — вытянут по вертикали. Две колонки, левая поуже, план целиком в
 *   высоту экрана.
 *
 * Пороги — с запасом от имеющихся планов: тип 3 «Кристалла» (1.6) остаётся
 * квадратным, а самый «короткий» номер «Сиалии» (2.1) уже широкий.
 */
export type PlanShape = 'wide' | 'square' | 'tall';
export const WIDE_PLAN_FROM = 1.75;
export const TALL_PLAN_UPTO = 0.8;

export function planShape(aspect: number | null | undefined): PlanShape {
  if (!aspect || !Number.isFinite(aspect)) return 'square';
  if (aspect >= WIDE_PLAN_FROM) return 'wide';
  if (aspect <= TALL_PLAN_UPTO) return 'tall';
  return 'square';
}
