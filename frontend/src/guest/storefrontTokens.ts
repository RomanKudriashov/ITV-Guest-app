/**
 * Словарь витрины из `docs/design/guest-prototype-v2.html`.
 *
 * Прототип — утверждённый ориентир, и его значения вынесены сюда ОДИН раз, а
 * не переписаны по компонентам: стекло, скримы и радиусы повторяются на
 * каждом экране, и разъехавшись однажды, они дальше расходятся молча.
 *
 * Здесь только то, что в прототипе задано явно и не выводится из темы отеля.
 * Палитра бренда (акцент, фон, поверхности) по-прежнему приходит из токенов
 * отеля — витрина обязана оставаться white-label.
 *
 * Светлая тема — R7. Значения ниже описывают тёмную витрину прототипа; R7
 * заведёт вторую и сделает их зависимыми от режима.
 */

/** Матовое стекло на накладных элементах: панели, чипы, нижнее меню. */
export const glass = {
  /** Плавающие чипы и кнопки поверх фото. */
  chip: {
    background: 'rgba(14,21,33,.44)',
    border: '1px solid rgba(255,255,255,.16)',
    backdropFilter: 'blur(20px) saturate(1.5)',
  },
  /** Верхняя строка (планшет/десктоп) и липкая строка категорий. */
  bar: {
    background: 'rgba(18,27,40,.38)',
    borderBottom: '1px solid rgba(255,255,255,.07)',
    backdropFilter: 'blur(26px) saturate(1.6)',
  },
  /** Нижнее меню телефона и шторка позиции — плотнее, они держат контент. */
  sheet: {
    background: 'rgba(9,14,22,.6)',
    border: '1px solid rgba(255,255,255,.1)',
    backdropFilter: 'blur(28px) saturate(1.5)',
  },
  /** Полоса активного заказа и карточки-удобства. */
  panel: {
    background: 'rgba(14,21,33,.44)',
    border: '1px solid rgba(255,255,255,.1)',
    backdropFilter: 'blur(16px)',
  },
} as const;

/**
 * Скримы поверх фото. Без них белый текст на светлом кадре нечитаем, а
 * подбирать градиент на каждом экране заново — способ получить пять разных.
 */
export const scrim = {
  /** Обложка отеля и шапка заведения на телефоне: затемнение снизу. */
  hero: 'linear-gradient(180deg,rgba(5,8,14,.22),transparent 42%,rgba(10,15,23,.95))',
  /** Шапка заведения на десктопе: текст слева, поэтому затемнение сбоку. */
  heroWide:
    'linear-gradient(90deg,rgba(5,8,14,.82),transparent 62%),linear-gradient(180deg,transparent,rgba(5,8,14,.5))',
  /** Плитка витрины: подпись живёт в нижней трети. */
  tile: 'linear-gradient(180deg,transparent,rgba(5,8,14,.9))',
} as const;

/** Высоты, на которые опирается липкое позиционирование. */
export const layout = {
  topBar: 62,
  bottomNav: 64,
  heroPhone: 252,
  heroWide: 304,
  venueHeadPhone: 214,
  venueHeadWide: 290,
} as const;

/** Размеры плиток bento. Крупная занимает две строки, широкая — две колонки. */
export type TileSize = 'S' | 'M' | 'L';

export const tileSpan: Record<TileSize, { gridRow?: string; gridColumn?: string }> = {
  S: {},
  M: { gridColumn: 'span 2' },
  L: { gridRow: 'span 2' },
};

/**
 * Золото — цвет действия, ведущего к заказу («в заказ», «оформить»).
 * Акцент бренда остаётся навигационным: так гость отличает «перейти» от
 * «заказать», не читая надписи.
 */
export const goldCta = {
  background: 'linear-gradient(180deg,#E0C588,#CBA96C)',
  color: '#1C1405',
  fontWeight: 800,
} as const;
