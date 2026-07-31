/**
 * Словарь корневой админки из `docs/design/platform-admin-prototype.html`.
 *
 * Здесь ФИОЛЕТОВЫЙ акцент — и это не украшение. Гостевая витрина и CMS отеля
 * white-label: их цвет приходит из бренда отеля. Админка платформы бренду
 * отеля не принадлежит, и её собственный цвет — единственный признак, по
 * которому видно, что открыт уровень ВЛАДЕЛЬЦА, а не CMS одного отеля. Спутать
 * их — значит править не тот отель.
 *
 * Поэтому значения фиксированные, а не из токенов темы: подмешивать сюда цвет
 * отеля означало бы ровно ту путаницу, от которой этот акцент и защищает.
 *
 * Светлая тема — R7. Здесь описан тёмный вид прототипа.
 */

/** Фиолетовый платформы. */
export const accent = {
  main: '#8A7BE0',
  light: '#A99BF0',
  soft: '#C3B8F2',
  wash: 'rgba(138,123,224,.18)',
  washSoft: 'rgba(138,123,224,.12)',
} as const;

/** Поверхности и линии. */
export const surface = {
  void: '#05080E',
  bg: '#0A0F17',
  s1: '#101825',
  s2: '#16212F',
  s3: '#1B2838',
  line: 'rgba(155,185,225,.12)',
  hair: 'rgba(155,185,225,.07)',
  bar: 'rgba(18,27,40,.5)',
} as const;

export const ink = {
  hi: '#EAF1F8',
  mid: '#A6B6C9',
  low: '#6C7E93',
} as const;

/** Состояния: одинаковые во всех таблицах админки. */
export const state = {
  ok: '#79D488',
  warn: '#E0A657',
  bad: '#E0736E',
  info: '#9BC6EE',
  gold: '#E0C588',
} as const;

export const layout = {
  nav: 236,
  topBar: 58,
} as const;

/** Фон страницы: тот же радиальный подсвет, что в прототипе. */
export const pageBackground =
  'radial-gradient(1100px 600px at 12% -8%,rgba(60,50,110,.16),transparent 60%),#05080E';

/** Панель-карточка — основной контейнер админки. */
export const panelSx = {
  bgcolor: surface.s1,
  border: `1px solid ${surface.line}`,
  borderRadius: '16px',
  p: 2,
} as const;

/** Кнопка главного действия. Фиолетовая — «это действие платформы». */
export const primaryButtonSx = {
  background: `linear-gradient(180deg,${accent.light},${accent.main})`,
  color: '#0b0a1e',
  fontWeight: 700,
  '&:hover': { background: `linear-gradient(180deg,${accent.light},${accent.main})`, filter: 'brightness(1.06)' },
} as const;

/** Пилюля статуса. Цвет несёт смысл, а не настроение. */
export function pillSx(tone: keyof typeof state | 'muted') {
  if (tone === 'muted') {
    return { bgcolor: 'rgba(140,150,165,.14)', color: ink.low };
  }
  const color = state[tone];
  return { bgcolor: `${color}22`, color };
}
