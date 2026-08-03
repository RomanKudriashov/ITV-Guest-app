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
 * ОБЕ ТЕМЫ. Раньше значения были плоскими и описывали только тёмную витрину —
 * из-за этого светлая тема физически не доходила до гостя: тема отеля
 * переключалась, а стекло и скримы оставались тёмными. Теперь набор — функция
 * режима. Тёмные значения ровно те же, что в прототипе (он тёмный и остаётся
 * эталоном вкуса); светлые — не «инверсия», а свой набор: на светлом фоне
 * стекло держится белой подложкой с тёмной волосяной границей, а скримы
 * ослаблены, потому что затемнять нужно меньше.
 */

import type { ThemeMode } from '@/theme/tokens';

export interface GlassSurface {
  background: string;
  border?: string;
  borderBottom?: string;
  backdropFilter: string;
}

export interface StorefrontGlass {
  /** Плавающие чипы и кнопки поверх фото. */
  chip: GlassSurface;
  /** Верхняя строка (планшет/десктоп) и липкая строка категорий. */
  bar: GlassSurface;
  /** Нижнее меню телефона и шторка позиции — плотнее, они держат контент. */
  sheet: GlassSurface;
  /** Полоса активного заказа и карточки-удобства. */
  panel: GlassSurface;
}

export interface StorefrontScrim {
  /** Обложка отеля и шапка заведения на телефоне: затемнение снизу. */
  hero: string;
  /** Шапка заведения на десктопе: текст слева, поэтому затемнение сбоку. */
  heroWide: string;
  /** Плитка витрины: подпись живёт в нижней трети. */
  tile: string;
}

export interface StorefrontTokens {
  glass: StorefrontGlass;
  scrim: StorefrontScrim;
  /** Золото — цвет действия, ведущего к заказу. */
  goldCta: { background: string; color: string; fontWeight: number };
  /**
   * Текст и иконки поверх кадра — там, где под ними скрим, а не поверхность.
   *
   * Белый в ОБЕИХ темах, и это не недосмотр: под ним всегда фотография с
   * затемняющим скримом, а не фон страницы. Светлый текст здесь — следствие
   * скрима, а не режима.
   */
  onMedia: {
    primary: string;
    secondary: string;
    hover: string;
    chipBorder: string;
    /** База затемняющего слоя поверх кадра — берётся с прозрачностью из данных. */
    dimBase: string;
  };
  /** Заглушка под кадром — видна, пока фото нет или оно не загрузилось. */
  mediaFallback: string;
  /** Подсветка «открыто» на чипе статуса поверх кадра. */
  openOnMedia: { color: string; border: string };
  /**
   * Плитка витрины. Заглушка ВСЕГДА тёмная в обеих темах: подпись на плитке
   * белая (она лежит на кадре), и светлая заглушка сломала бы контраст ровно
   * там, где фотографии ещё нет.
   */
  /** Затемнение позади модалок и шторок. */
  dialogBackdrop: string;
  /** Скрим экрана входа: кадр отеля во весь экран, форма поверх него. */
  entryScrim: string;
  tile: {
    fallbackColor: string;
    fallbackGradient: string;
    scrim: string;
    disabledVeil: string;
    titleShadow: string;
    metaShadow: string;
  };
}

const DARK: StorefrontTokens = {
  glass: {
    chip: {
      background: 'rgba(14,21,33,.44)',
      border: '1px solid rgba(255,255,255,.16)',
      backdropFilter: 'blur(20px) saturate(1.5)',
    },
    bar: {
      background: 'rgba(18,27,40,.38)',
      borderBottom: '1px solid rgba(255,255,255,.07)',
      backdropFilter: 'blur(26px) saturate(1.6)',
    },
    sheet: {
      background: 'rgba(9,14,22,.6)',
      border: '1px solid rgba(255,255,255,.1)',
      backdropFilter: 'blur(28px) saturate(1.5)',
    },
    panel: {
      background: 'rgba(14,21,33,.44)',
      border: '1px solid rgba(255,255,255,.1)',
      backdropFilter: 'blur(16px)',
    },
  },
  scrim: {
    hero: 'linear-gradient(180deg,rgba(5,8,14,.22),transparent 42%,rgba(10,15,23,.95))',
    heroWide:
      'linear-gradient(90deg,rgba(5,8,14,.82),transparent 62%),linear-gradient(180deg,transparent,rgba(5,8,14,.5))',
    tile: 'linear-gradient(180deg,transparent,rgba(5,8,14,.9))',
  },
  goldCta: {
    background: 'linear-gradient(180deg,#E0C588,#CBA96C)',
    color: '#1C1405',
    fontWeight: 800,
  },
  onMedia: {
    primary: '#FFFFFF',
    secondary: 'rgba(255,255,255,.74)',
    hover: 'rgba(255,255,255,.18)',
    chipBorder: 'rgba(255,255,255,.18)',
    dimBase: '#000000',
  },
  // `--grad` прототипа.
  mediaFallback: 'linear-gradient(150deg,#1c2b43,#0b1220)',
  openOnMedia: { color: '#9BE7A6', border: 'rgba(121,212,136,.5)' },
  dialogBackdrop: 'rgba(4,9,16,0.62)',
  // Ровно `.a .scrim` из `login-ac.html`: затемнение идёт СБОКУ, оттуда же,
  // где стоит форма. Чисто вертикальный скрим оставлял середину кадра почти
  // открытой — подсказка про QR и «просто посмотреть меню» ложились на
  // светлую часть фотографии и переставали читаться.
  entryScrim:
    'linear-gradient(90deg,rgba(6,10,17,.9) 0%,rgba(6,10,17,.55) 44%,rgba(6,10,17,.15) 100%),linear-gradient(180deg,rgba(6,10,17,.5),transparent 32%,rgba(6,10,17,.7))',
  tile: {
    fallbackColor: '#0a0f18',
    fallbackGradient: 'linear-gradient(160deg, #16233b 0%, #080c14 92%)',
    scrim:
      'linear-gradient(to top, rgba(5,7,12,.82) 0%, rgba(5,7,12,.5) 22%, transparent 46%)',
    disabledVeil: 'rgba(5,7,12,.35)',
    titleShadow: '0 2px 14px rgba(0,0,0,0.6)',
    metaShadow: '0 1px 8px rgba(0,0,0,0.55)',
  },
};

/**
 * Светлая витрина.
 *
 * Стекло — белая подложка: тёмная плашка поверх светлой страницы читается как
 * инородная заплата, а не как накладной слой. Границы тёмные и очень слабые:
 * на белом видна любая линия, и прототипные .16 белого здесь дали бы грязь.
 *
 * Скримы поверх ФОТО остаются тёмными в обеих темах и лишь ослаблены: под
 * ними всегда лежит кадр, а не фон страницы, и белый текст на нём читается
 * только по затемнению. Осветлять их «ради светлой темы» — значит сделать
 * подписи на плитках нечитаемыми.
 */
const LIGHT: StorefrontTokens = {
  glass: {
    chip: {
      background: 'rgba(255,255,255,.62)',
      border: '1px solid rgba(18,32,47,.10)',
      backdropFilter: 'blur(20px) saturate(1.4)',
    },
    bar: {
      background: 'rgba(255,255,255,.72)',
      borderBottom: '1px solid rgba(18,32,47,.08)',
      backdropFilter: 'blur(26px) saturate(1.5)',
    },
    sheet: {
      background: 'rgba(255,255,255,.86)',
      border: '1px solid rgba(18,32,47,.10)',
      backdropFilter: 'blur(28px) saturate(1.4)',
    },
    panel: {
      background: 'rgba(255,255,255,.70)',
      border: '1px solid rgba(18,32,47,.09)',
      backdropFilter: 'blur(16px)',
    },
  },
  scrim: {
    hero: 'linear-gradient(180deg,rgba(5,8,14,.14),transparent 44%,rgba(8,13,20,.82))',
    heroWide:
      'linear-gradient(90deg,rgba(5,8,14,.72),transparent 64%),linear-gradient(180deg,transparent,rgba(5,8,14,.38))',
    tile: 'linear-gradient(180deg,transparent,rgba(5,8,14,.82))',
  },
  // Золото на светлом берём на два тона глубже: прототипное #E0C588 на белом
  // теряется и перестаёт читаться как главное действие.
  goldCta: {
    background: 'linear-gradient(180deg,#C9A461,#AC8A4B)',
    color: '#231903',
    fontWeight: 800,
  },
  // Поверх кадра — тот же белый: см. комментарий у `onMedia` в типе.
  onMedia: {
    primary: '#FFFFFF',
    secondary: 'rgba(255,255,255,.80)',
    hover: 'rgba(255,255,255,.22)',
    chipBorder: 'rgba(255,255,255,.24)',
    dimBase: '#000000',
  },
  // Заглушка светлее: пустой кадр на светлой странице не должен читаться
  // тёмной дырой.
  mediaFallback: 'linear-gradient(150deg,#C6D3E4,#9FB2CC)',
  openOnMedia: { color: '#C4F5CD', border: 'rgba(121,212,136,.62)' },
  dialogBackdrop: 'rgba(18,32,47,0.38)',
  // Экран входа стоит на фотографии отеля в ОБЕИХ темах, и форма на нём одна
  // и та же — белая по кадру. Ослаблять затемнение «ради светлой темы» здесь
  // значит сделать форму нечитаемой: режим интерфейса не меняет того, что под
  // текстом лежит снимок. Держим тот же скрим, что и в тёмной.
  entryScrim:
    'linear-gradient(90deg,rgba(6,10,17,.9) 0%,rgba(6,10,17,.55) 44%,rgba(6,10,17,.15) 100%),linear-gradient(180deg,rgba(6,10,17,.5),transparent 32%,rgba(6,10,17,.7))',
  // Плитка одинакова в обеих темах — см. комментарий у `tile` в типе.
  tile: {
    fallbackColor: '#0a0f18',
    fallbackGradient: 'linear-gradient(160deg, #16233b 0%, #080c14 92%)',
    scrim:
      'linear-gradient(to top, rgba(5,7,12,.82) 0%, rgba(5,7,12,.5) 22%, transparent 46%)',
    disabledVeil: 'rgba(5,7,12,.35)',
    titleShadow: '0 2px 14px rgba(0,0,0,0.6)',
    metaShadow: '0 1px 8px rgba(0,0,0,0.55)',
  },
};

/** Набор витрины для активного режима. */
export function storefrontTokens(mode: ThemeMode): StorefrontTokens {
  return mode === 'dark' ? DARK : LIGHT;
}

/** Высоты, на которые опирается липкое позиционирование. Режима не касаются. */
export const layout = {
  topBar: 62,
  bottomNav: 64,
  heroPhone: 252,
  heroWide: 304,
  venueHeadPhone: 214,
  venueHeadWide: 290,
  /**
   * На столько панель контента наезжает скруглением на кадр над ней.
   *
   * Значение общее для героя каталога и шапки заведения: панель одна и та же
   * (`CatalogPage`), а кадров над ней два. Пока число жило только в каталоге,
   * шапка заведения о нём не знала и накрывала им чип статуса — тот, кто
   * рисует кадр, обязан оставить этот запас снизу.
   */
  panelOverlap: 28,

  /**
   * Плавающая группа контролов телефона (номер/язык/тема) и высота, которую
   * она занимает сверху.
   *
   * Числа лежат ЗДЕСЬ, а не по месту, потому что от них зависят два разных
   * компонента: шелл, который группу рисует, и каталог, который пинит под ней
   * строку категорий. Пока они жили порознь, группа стояла на `top: 10`, а
   * строка категорий пинилась в `top: 0` — обе в одной полосе, и на узком
   * экране чип наезжал на названия разделов. Горизонтальный запас `pr: 150px`
   * в табах это маскировал ровно до тех пор, пока группа не стала шире.
   */
  floatingTop: 10,
  floatingHeight: 38,
} as const;

/** Куда пинить липкую строку, чтобы она прошла ПОД плавающей группой. */
export const stickyUnderFloating = layout.floatingTop + layout.floatingHeight + 8;

/** Размеры плиток bento. Крупная занимает две строки, широкая — две колонки. */
export type TileSize = 'S' | 'M' | 'L';

export const tileSpan: Record<TileSize, { gridRow?: string; gridColumn?: string }> = {
  S: {},
  M: { gridColumn: 'span 2' },
  L: { gridRow: 'span 2' },
};
