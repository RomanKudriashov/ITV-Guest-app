import { useEffect, useState } from 'react';

/**
 * РАЗДЕЛЫ ЛЕНДИНГА И ПОВЕДЕНИЕ ПОЛОСЫ — в одном месте, потому что все три
 * потребителя должны считать одинаково: сама полоса, переключатели, которые
 * стоят в её строке, и переход по якорю, который обязан остановиться НИЖЕ неё.
 */

/**
 * Высота липкой полосы.
 *
 * Число живёт здесь, а не в каждом из мест: полоса, переключатели и отступ
 * якоря считались по отдельности, и значки стояли выше середины строки, а
 * заголовок раздела при переходе уезжал под полосу.
 */
export const NAV_HEIGHT = 52;

/** Зазор между полосой и заголовком, к которому перешли. */
const ANCHOR_GAP = 12;

/**
 * Пункты меню — ОБХОД СТРАНИЦЫ СВЕРХУ ВНИЗ, а не рубрикация.
 *
 * Надписи взяты те, что стоят на самой странице: у блоков гостя, персонала и
 * номера это надзаголовок, у остальных — сам заголовок раздела. Сокращён ровно
 * один: «Один продукт на трёх устройствах» в строке меню занял бы четверть
 * полосы, и от него оставлено «Устройства».
 *
 * Секции без заголовка в меню нет: сразу под обложкой лежат три утверждения, у
 * которых заголовка на странице нет вовсе. Придумывать его ради пункта значило
 * бы завести надпись, которой на экране не существует.
 */
export const SECTIONS = [
  'guest',
  'staff',
  'room',
  'devices',
  'how',
  'modules',
  'audience',
  'contact',
] as const;

export type SectionKey = (typeof SECTIONS)[number];

/**
 * Быстрое скольжение к разделу.
 *
 * ПОЧЕМУ НЕ `scroll-behavior: smooth`. Длительность там задаёт браузер и считает
 * её от расстояния: разделы здесь во весь экран, и переход через полстраницы
 * тянулся больше секунды — это уже не «видно, куда попал», а ожидание. Здесь
 * длительность своя и одинаковая, а кривая замедляется к концу, чтобы приезд
 * читался как остановка, а не как обрыв.
 *
 * ОСТАНОВКА НИЖЕ ПОЛОСЫ. Цель — верх раздела минус высота полосы и зазор; иначе
 * заголовок оказывается ровно под ней, и человек приезжает к тексту без начала.
 *
 * ПРОСЬБУ НЕ ДВИГАТЬ УВАЖАЕМ ЦЕЛИКОМ: переход мгновенный, без единого кадра.
 *
 * ЖЕСТ ПОСЕТИТЕЛЯ ОТМЕНЯЕТ ПЕРЕХОД. Крутить колесо во время анимации и видеть,
 * как страницу утаскивает обратно, — худшее, что может сделать прокрутка.
 */
export function scrollToSection(id: string, calm: boolean): void {
  const target = document.getElementById(id);
  if (!target) return;

  const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - NAV_HEIGHT - ANCHOR_GAP);
  if (calm) {
    window.scrollTo({ top });
    return;
  }

  const from = window.scrollY;
  const distance = top - from;
  if (Math.abs(distance) < 2) return;

  // Постоянная длительность, а не «пиксели в секунду»: через всю страницу
  // должно ехать столько же, сколько к соседнему разделу.
  const DURATION = 480;
  const started = performance.now();
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };
  window.addEventListener('wheel', cancel, { passive: true, once: true });
  window.addEventListener('touchstart', cancel, { passive: true, once: true });

  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  const step = (now: number) => {
    if (cancelled) return;
    const progress = Math.min(1, (now - started) / DURATION);
    window.scrollTo({ top: from + distance * ease(progress) });
    if (progress < 1) requestAnimationFrame(step);
    else {
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchstart', cancel);
    }
  };
  requestAnimationFrame(step);
}

/**
 * Какой раздел сейчас на экране.
 *
 * ЧИТАЮЩАЯ ЛИНИЯ. Активен последний раздел, чьё начало уже прошло под полосой.
 * Линия проведена ровно там, где раздел из-под полосы выходит, и берётся из тех
 * же двух величин, что и остановка при переходе по якорю: считай их порознь —
 * нажатие на пункт подсвечивало бы соседний.
 *
 * ПОЧЕМУ НЕ НАБЛЮДАТЕЛЬ, ХОТЯ ОН БЫЛ ЗДЕСЬ ПЕРВЫМ. `IntersectionObserver`
 * сообщает о пересечении ГРАНИЦЫ корня, а не о положении на ней. Корень
 * сжимали до узкой полосы под меню — событие всё равно приходило на её краю, и
 * к моменту пересчёта раздел успевал уйти на несколько пикселей ниже линии:
 * нажатие на «Устройства» оставляло подсвеченным «Управление номером». Ловилось
 * это прогоном, а не глазами, и дважды — сначала на «первом из видимых», потом
 * на узкой полосе.
 *
 * Обработчик прокрутки честнее: он отвечает на вопрос «где мы сейчас», который
 * здесь и задан. Цена — восемь замеров на кадр прокрутки, и они собраны в один
 * кадр через `requestAnimationFrame`: событий прокрутки в кадре бывает
 * несколько, а перерисовка всё равно одна.
 */
export function useActiveSection(ids: readonly string[]): string {
  const [active, setActive] = useState('');

  useEffect(() => {
    const nodes = ids
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => Boolean(node));
    if (!nodes.length) return undefined;

    const line = NAV_HEIGHT + ANCHOR_GAP;
    let frame = 0;

    const recount = () => {
      frame = 0;
      /*
        ДНО СТРАНИЦЫ — ОТДЕЛЬНЫЙ СЛУЧАЙ, И ЭТО НЕ ПРИДИРКА.

        Последний раздел до линии не доезжает никогда: прокрутка кончается
        раньше, чем его начало поднимется под полосу. По общему правилу он не
        подсветился бы ни разу — человек стоит в «Как подключиться», а горит
        «Возможности». Упёрлись в дно — активен последний.
      */
      const bottom =
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      if (bottom) {
        setActive(nodes[nodes.length - 1].id);
        return;
      }

      let current = '';
      for (const node of nodes) {
        if (node.getBoundingClientRect().top <= line + 1) current = node.id;
      }
      // Ни один раздел линию не прошёл — мы ещё на обложке, подсвечивать нечего.
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(recount);
    };

    recount();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [ids]);

  return active;
}
