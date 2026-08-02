/**
 * Словарь корневой админки из `docs/design/platform-admin-prototype.html`.
 *
 * Здесь ФИОЛЕТОВЫЙ акцент — и это не украшение. Гостевая витрина и CMS отеля
 * white-label: их цвет приходит из бренда отеля. Админка платформы бренду
 * отеля не принадлежит, и её собственный цвет — единственный признак, по
 * которому видно, что открыт уровень ВЛАДЕЛЬЦА, а не CMS одного отеля. Спутать
 * их — значит править не тот отель.
 *
 * Поэтому акцент фиксированный, а не из токенов отеля: подмешивать сюда цвет
 * отеля означало бы ровно ту путаницу, от которой этот акцент и защищает.
 *
 * ОБЕ ТЕМЫ — ЧЕРЕЗ CSS-ПЕРЕМЕННЫЕ. Раньше значения были плоскими и описывали
 * только тёмный прототип: режим переключался, а поверхности оставались
 * тёмными. Сделать набор функцией режима значило бы протащить хук в тринадцать
 * файлов и переписать каждое обращение — много правок ради одного факта.
 * Вместо этого имена остались прежними, а значения за ними теперь `var(--adm-*)`:
 * пара значений на переменную живёт ЗДЕСЬ (ниже, в `ADMIN_PALETTE`), а корень
 * админки один раз подставляет нужную половину через `adminCssVars(mode)`.
 *
 * Правило «ни одного цвета вне словаря» при этом усиливается: цвет физически
 * нельзя написать в компоненте — там доступно только имя переменной.
 */

import type { ThemeMode } from '@/theme/tokens';

type Pair = { dark: string; light: string };

/**
 * Единственное место, где в админке есть цвет.
 *
 * Тёмная половина — ровно прототип. Светлая — свой набор, а не инверсия:
 * поверхности идут от белого вглубь так же, как тёмные идут от почти-чёрного,
 * линии тёмные и слабые (на светлом видна каждая), а состояния взяты глубже —
 * пастель прототипа рассчитана на тёмную подложку и на белом сливается.
 *
 * Фиолетовый на светлой глубже прототипного: #8A7BE0 на белом не держит
 * контраст для текста, а роль «это уровень платформы» он обязан играть в обеих
 * темах одинаково внятно.
 */
const ADMIN_PALETTE: Record<string, Pair> = {
  'accent-main': { dark: '#8A7BE0', light: '#5D4CBE' },
  'accent-light': { dark: '#A99BF0', light: '#7565D6' },
  'accent-soft': { dark: '#C3B8F2', light: '#8A7BE0' },
  'accent-wash': { dark: 'rgba(138,123,224,.18)', light: 'rgba(93,76,190,.14)' },
  'accent-wash-soft': { dark: 'rgba(138,123,224,.12)', light: 'rgba(93,76,190,.08)' },
  'accent-on': { dark: '#0b0a1e', light: '#FFFFFF' },
  // Тёмный хвост градиента монограммы: она всегда с белой буквой, поэтому на
  // светлой теме подложка остаётся глубокой — иначе буква пропадает.
  'accent-deep': { dark: '#4b3fa0', light: '#3E3392' },
  'accent-deep-2': { dark: '#3a3170', light: '#332B63' },
  /** Надпись на фиолетовой монограмме — белая в обеих темах. */
  'on-brand': { dark: '#FFFFFF', light: '#FFFFFF' },

  'surface-void': { dark: '#05080E', light: '#EEF1F7' },
  'surface-bg': { dark: '#0A0F17', light: '#F4F6FB' },
  'surface-s1': { dark: '#101825', light: '#FFFFFF' },
  'surface-s2': { dark: '#16212F', light: '#F7F9FC' },
  'surface-s3': { dark: '#1B2838', light: '#EEF2F8' },
  'surface-line': { dark: 'rgba(155,185,225,.12)', light: 'rgba(28,45,68,.14)' },
  'surface-hair': { dark: 'rgba(155,185,225,.07)', light: 'rgba(28,45,68,.08)' },
  'surface-bar': { dark: 'rgba(18,27,40,.5)', light: 'rgba(255,255,255,.72)' },

  'ink-hi': { dark: '#EAF1F8', light: '#12202F' },
  'ink-mid': { dark: '#A6B6C9', light: '#51637A' },
  'ink-low': { dark: '#6C7E93', light: '#7C8CA1' },

  'state-ok': { dark: '#79D488', light: '#2E7D4F' },
  'state-warn': { dark: '#E0A657', light: '#B26A16' },
  'state-bad': { dark: '#E0736E', light: '#C0453F' },
  'state-info': { dark: '#9BC6EE', light: '#2A6FA8' },
  'state-gold': { dark: '#E0C588', light: '#94742F' },

  // Подложки пилюль. Отдельными переменными, а не «цвет + 22» строкой: с
  // `var()` такая склейка не работает, а прозрачность здесь нужна разная —
  // на светлом фоне та же альфа читается заметно грязнее.
  'state-ok-wash': { dark: 'rgba(121,212,136,.13)', light: 'rgba(46,125,79,.12)' },
  'state-warn-wash': { dark: 'rgba(224,166,87,.13)', light: 'rgba(178,106,22,.12)' },
  'state-bad-wash': { dark: 'rgba(224,115,110,.13)', light: 'rgba(192,69,63,.12)' },
  'state-info-wash': { dark: 'rgba(155,198,238,.13)', light: 'rgba(42,111,168,.12)' },
  'state-gold-wash': { dark: 'rgba(224,197,136,.13)', light: 'rgba(148,116,47,.12)' },
  'state-muted-wash': { dark: 'rgba(140,150,165,.14)', light: 'rgba(90,105,125,.12)' },

  'page-background': {
    dark: 'radial-gradient(1100px 600px at 12% -8%,rgba(60,50,110,.16),transparent 60%),#05080E',
    light: 'radial-gradient(1100px 600px at 12% -8%,rgba(93,76,190,.10),transparent 60%),#F4F6FB',
  },
};

/**
 * Значения переменных для режима. Ставится ОДИН раз на корень админки —
 * дальше всё дерево читает те же имена и переключается вместе с темой.
 */
export function adminCssVars(mode: ThemeMode): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, pair] of Object.entries(ADMIN_PALETTE)) {
    vars[`--adm-${name}`] = pair[mode];
  }
  return vars;
}

const v = (name: string) => `var(--adm-${name})`;

/** Фиолетовый платформы. */
export const accent = {
  main: v('accent-main'),
  light: v('accent-light'),
  soft: v('accent-soft'),
  wash: v('accent-wash'),
  washSoft: v('accent-wash-soft'),
  /** Цвет надписи на фиолетовой кнопке. */
  onAccent: v('accent-on'),
  deep: v('accent-deep'),
  deep2: v('accent-deep-2'),
  /** Текст поверх фиолетовой заливки (монограмма, аватар). */
  onBrand: v('on-brand'),
} as const;

/** Поверхности и линии. */
export const surface = {
  void: v('surface-void'),
  bg: v('surface-bg'),
  s1: v('surface-s1'),
  s2: v('surface-s2'),
  s3: v('surface-s3'),
  line: v('surface-line'),
  hair: v('surface-hair'),
  bar: v('surface-bar'),
} as const;

export const ink = {
  hi: v('ink-hi'),
  mid: v('ink-mid'),
  low: v('ink-low'),
} as const;

/** Состояния: одинаковые во всех таблицах админки. */
export const state = {
  ok: v('state-ok'),
  warn: v('state-warn'),
  bad: v('state-bad'),
  info: v('state-info'),
  gold: v('state-gold'),
} as const;

export const layout = {
  nav: 236,
  topBar: 58,
} as const;

/** Фон страницы: тот же радиальный подсвет, что в прототипе. */
export const pageBackground = v('page-background');

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
  color: accent.onAccent,
  fontWeight: 700,
  '&:hover': {
    background: `linear-gradient(180deg,${accent.light},${accent.main})`,
    filter: 'brightness(1.06)',
  },
} as const;

/** Пилюля статуса. Цвет несёт смысл, а не настроение. */
export function pillSx(tone: keyof typeof state | 'muted') {
  if (tone === 'muted') {
    return { bgcolor: v('state-muted-wash'), color: ink.low };
  }
  return { bgcolor: v(`state-${tone}-wash`), color: state[tone] };
}
