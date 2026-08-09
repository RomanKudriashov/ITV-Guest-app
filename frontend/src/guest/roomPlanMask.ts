import type { CSSProperties } from 'react';

/**
 * Окно света на светлом кадре: скруглённый прямоугольник с мягким краем.
 *
 * ПОЧЕМУ НЕ ЭЛЛИПС. До этого окно вырезалось эллипсом, вписанным в
 * прямоугольник зоны. Эллипс, вписанный в прямоугольник, углов не закрывает по
 * построению — и углы комнаты оставались тёмными при включённом свете,
 * заметнее всего в спальне. Увеличить эллипс нельзя: чтобы дотянуться до
 * углов, он вылезет на соседнюю комнату через перегородку.
 *
 * ПОЧЕМУ НЕ `overflow: hidden` С МАСКОЙ. На живом iOS это сочетание теряет
 * маску: остаётся клип, и вместо мягкого света получается жёсткий
 * прямоугольник. Наступали в G5d, возвращаться нельзя.
 *
 * КАК УСТРОЕНО. Два линейных градиента — по горизонтали и по вертикали, — и
 * пересечение их непрозрачностей. Внутри прямоугольника оба непрозрачны, и
 * область светится ЦЕЛИКОМ, включая углы. По краю каждый уходит в прозрачность,
 * а в углу непрозрачности перемножаются — получается скруглённый угол, который
 * и нужен: у света в комнате нет прямых углов.
 *
 * РАСТУШЁВКА УХОДИТ В ЗАПАС МАСКИ. В геометрии на зону два прямоугольника:
 * `hit` — сама комната, `mask` — она же, расширенная под растушёвку. Мягкий
 * край живёт ровно в этом запасе, поэтому свет не переливается за перегородку:
 * к границе `hit` непрозрачность уже полная, а к границе `mask` — уже нулевая.
 */
export interface PlanRectLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Минимальная растушёвка в долях прямоугольника маски.
 *
 * Нужна на случай, если разметка сделана без запаса (`mask` совпал с `hit`):
 * край в один пиксель читается как заплата поверх кадра, а не как свет.
 */
const MIN_FEATHER = 0.06;

/** Позиция фона в процентах: `p%` совмещает `p%` картинки с `p%` контейнера. */
const positionPercent = (offset: number, size: number) =>
  size >= 100 ? 0 : (offset / (100 - size)) * 100;

const feather = (inner: number, outer: number) =>
  Math.min(45, Math.max(MIN_FEATHER, (outer - inner) / 2 / outer) * 100);

/**
 * Стиль слоя светлого кадра для одной зоны.
 *
 * `ink` и `edge` приходят из словаря: здесь это не цвет, а форма прозрачности
 * («показать» и «спрятать»), но цвету место всё равно в словаре.
 */
export function zoneWindowStyle(
  hit: PlanRectLike,
  mask: PlanRectLike,
  ink: string,
  edge: string,
): CSSProperties {
  const fx = feather(hit.w, mask.w);
  const fy = feather(hit.h, mask.h);
  const horizontal =
    `linear-gradient(to right, ${edge} 0%, ${ink} ${fx}%, ` +
    `${ink} ${100 - fx}%, ${edge} 100%)`;
  const vertical =
    `linear-gradient(to bottom, ${edge} 0%, ${ink} ${fy}%, ` +
    `${ink} ${100 - fy}%, ${edge} 100%)`;
  const image = `${horizontal}, ${vertical}`;
  const size = `${mask.w}% ${mask.h}%`;
  const position = `${positionPercent(mask.x, mask.w)}% ${positionPercent(mask.y, mask.h)}%`;

  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskSize: size,
    WebkitMaskSize: size,
    maskPosition: position,
    WebkitMaskPosition: position,
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    // Пересечение двух слоёв. `intersect` — современное написание, `source-in`
    // — то же самое для WebKit, который на iOS всё ещё отвечает только на него.
    maskComposite: 'intersect',
    WebkitMaskComposite: 'source-in',
  };
}
