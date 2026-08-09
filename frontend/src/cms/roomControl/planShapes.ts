/**
 * Геометрия плана в редакторе: проценты, и только проценты.
 *
 * Пикселей здесь нет ни одного — ни в состоянии, ни в том, что уезжает на
 * сервер. Кадр у каждого типа свой, медиапайплайн нарезает варианты, и любая
 * координата в пикселях перестала бы совпадать с картинкой при первой же
 * смене размера.
 *
 * МАСКА СЧИТАЕТСЯ ИЗ ЗОНЫ, а не рисуется отдельно. Маска — это та же комната,
 * расширенная под растушёвку света: рисовать её руками значит держать два
 * прямоугольника в согласии вручную и однажды не удержать. Ширина расширения
 * (`feather`) читается обратно из сохранённой разметки, поэтому чужая, снятая
 * с концепта геометрия не переписывается нашим значением по умолчанию.
 */
import type { PlanRect, PlanZone } from '@/api/grms';

/** Насколько маска шире зоны с каждой стороны, в процентах кадра. */
export const DEFAULT_FEATHER = 4;

/** Меньше — это промах мышью, а не зона. */
export const MIN_SIZE = 1.5;

export const round1 = (value: number) => Math.round(value * 10) / 10;

export function maskOf(hit: PlanRect, feather: number): PlanRect {
  return {
    x: round1(hit.x - feather),
    y: round1(hit.y - feather),
    w: round1(hit.w + feather * 2),
    h: round1(hit.h + feather * 2),
  };
}

/**
 * Обратное чтение растушёвки. Разметка могла приехать из другого типа или из
 * концепта — своё значение по умолчанию туда подставлять нельзя.
 */
export function featherOf(zone: PlanZone | undefined): number {
  if (!zone) return DEFAULT_FEATHER;
  const value = round1(zone.hit.x - zone.mask.x);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_FEATHER;
}

/** Прямоугольник из двух углов перетаскивания. */
export function rectFromDrag(ax: number, ay: number, bx: number, by: number): PlanRect {
  return {
    x: round1(Math.min(ax, bx)),
    y: round1(Math.min(ay, by)),
    w: round1(Math.abs(bx - ax)),
    h: round1(Math.abs(by - ay)),
  };
}

export const clampPercent = (value: number) => round1(Math.max(0, Math.min(100, value)));

/**
 * Окно света на светлом кадре — ТОТ ЖЕ помощник, что у гостя: редактор обязан
 * показывать ровно то, что увидит гость, иначе разметку правят вслепую. Своей
 * копии формы здесь нет намеренно — две копии однажды разъедутся.
 */
export { zoneWindowStyle } from '@/guest/roomPlanMask';
