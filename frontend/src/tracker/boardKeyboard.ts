import { KeyboardCode, type KeyboardCoordinateGetter } from '@dnd-kit/core';

/**
 * СТРЕЛКА ВЕДЁТ К СОСЕДНЕЙ КОЛОНКЕ, А НЕ НА 25 ПИКСЕЛЕЙ.
 *
 * Замер на живой доске: шаг по умолчанию — 25px, ширина колонки 340px. То есть
 * чтобы переложить заказ из «Принят» в «Готовится», повару нужно пятнадцать раз
 * нажать стрелку, глядя, как карточка ползёт через пустоту. Клавиатурный жест
 * при этом формально «работал», и проверка на него зеленела бы.
 *
 * Колонка — единица работы на этой доске, поэтому единица шага тоже она.
 *
 * ВЕРТИКАЛИ ЗДЕСЬ НЕТ, И ЭТО РЕШЕНИЕ, А НЕ ПРОПУСК. Перестановка внутри
 * колонки клавиатурой сделана ОТДЕЛЬНЫМ действием (Alt+↑/↓ на карточке, см.
 * `OrderCard`), а не шагом этого жеста. Причина замерена, а не предположена:
 * `KeyboardSensor` применяет возвращённую координату не целиком — на живой
 * доске из требуемых 116 пикселей карточка уезжала на 40, — и «шаг на соседа»
 * превращался в ползание, зависящее от высоты карточек. Координатный getter
 * хорош для колонок: они широкие и промахнуться мимо соседней нельзя.
 */
export const columnCoordinateGetter: KeyboardCoordinateGetter = (
  event,
  { context: { droppableContainers, collisionRect } },
) => {
  if (!collisionRect) return undefined;

  if (event.code !== KeyboardCode.Right && event.code !== KeyboardCode.Left) return undefined;

  const columns = Array.from(droppableContainers.values())
    .filter((container) => String(container.id).startsWith('column:') && container.rect.current)
    .map((container) => container.rect.current as { left: number; top: number; width: number; height: number })
    .sort((a, b) => a.left - b.left);
  if (columns.length < 2) return undefined;

  const centre = collisionRect.left + collisionRect.width / 2;
  // Текущая колонка — ближайшая по центру: карточка может стоять между двумя,
  // и «та, в чьих границах центр» не находится вовсе.
  let current = 0;
  let best = Number.POSITIVE_INFINITY;
  columns.forEach((column, index) => {
    const distance = Math.abs(column.left + column.width / 2 - centre);
    if (distance < best) {
      best = distance;
      current = index;
    }
  });

  const next = event.code === KeyboardCode.Right ? current + 1 : current - 1;
  const target = columns[next];
  // С краю доски шага нет: возвращать ту же точку значило бы делать вид, что
  // нажатие что-то сделало.
  if (!target) return undefined;

  return {
    x: target.left + target.width / 2 - collisionRect.width / 2,
    y: collisionRect.top,
  };
};
