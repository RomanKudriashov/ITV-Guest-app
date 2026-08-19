/**
 * Словарь платформенной консоли — ПРОИЗВОДНАЯ ОТ ТОКЕНОВ ПРОЕКТА.
 *
 * Раньше здесь лежал самостоятельный набор цвета с фиолетовым акцентом. Он
 * решал реальную задачу — отличить уровень владельца платформы от CMS одного
 * отеля, — но платил за это тем, что консоль переставала быть частью продукта:
 * свой синий, свои поверхности, своя шкала кегля, и ни одной точки, где
 * изменение бренда доходило бы сюда.
 *
 * ТЕПЕРЬ ИСТОЧНИК ОДИН: `DEFAULT_BRAND_TOKENS` из `theme/tokens.ts` —
 * ПЛАТФОРМЕННЫЙ дефолт, а не палитра отеля. Разделение уровней от этого не
 * пропадает, а становится структурным: консоль всегда читает платформенный
 * набор и физически не может взять бренд отеля, потому что не обращается к
 * `useAppTheme().tokens` вовсе. CMS же красится тем, что пришло с сервера.
 * Спутать уровни по цвету больше нельзя — но и по цвету же видно, что это
 * один продукт.
 *
 * Ни одного самостоятельного цвета в файле нет: всё либо взято из токенов
 * проекта, либо выведено из них той же математикой, что в `createAppTheme`
 * (`darken`/`lighten`/`alpha`). Правило «ни одного цвета вне словаря»
 * (`scripts/check-colors.mjs`) при этом усиливается: теперь и в самом словаре
 * цвета не написать.
 *
 * ОБЕ ТЕМЫ — ЧЕРЕЗ CSS-ПЕРЕМЕННЫЕ. Имена `--adm-*` те же, что были: значения
 * за ними подставляет `adminCssVars(mode)`, а ставит их на `:root` область
 * `AdminScope` (см. `AdminApp.tsx`). Именно на `:root`, а не на корень
 * оболочки: MUI выносит диалоги и меню в портал к `document.body`, и пока
 * переменные жили на оболочке, ВСЕ диалоги консоли рисовались без словаря —
 * `border: 1px solid var(--adm-surface-line)` с неопределённой переменной
 * браузер выбрасывает целиком, и рамки у пилюль просто не было.
 */

import { alpha, darken, lighten } from '@mui/material/styles';

import { DEFAULT_BRAND_TOKENS, type ThemeMode } from '@/theme/tokens';

type Pair = { dark: string; light: string };

/**
 * Собирает половину словаря для одного режима.
 *
 * `deep` — «сильнее к контрасту с фоном»: на светлой теме темнее, на тёмной
 * светлее. Тот же приём, что `shift()` в `createAppTheme`; он позволяет
 * держать один набор правил на обе темы вместо двух списков значений.
 */
function paletteFor(mode: ThemeMode) {
  const c = DEFAULT_BRAND_TOKENS.palette[mode];
  const isDark = mode === 'dark';
  const deep = (color: string, amount: number) =>
    isDark ? lighten(color, amount) : darken(color, amount);

  return {
    'accent-main': c.primary,
    'accent-light': deep(c.primary, 0.18),
    /** Акцент КАК ТЕКСТ на поверхности — глубже заливки, иначе не читается. */
    'accent-soft': deep(c.primary, 0.1),
    'accent-wash': alpha(c.primary, isDark ? 0.18 : 0.12),
    'accent-wash-soft': alpha(c.primary, isDark ? 0.12 : 0.07),
    'accent-on': c.primaryContrast,
    'accent-deep': deep(c.primary, 0.34),
    'accent-deep-2': deep(c.primary, 0.52),
    /**
     * Надпись на заливке акцента. Раньше была белой в ОБЕИХ темах, и на
     * светлой это давало контраст 1.00 — название платформы в боковой панели
     * физически отсутствовало на белом. Теперь это контрастная пара акцента.
     */
    'on-brand': c.primaryContrast,

    // Пустота ВСЕГДА темнее фона — в обеих темах, потому что это «дальше от
    // взгляда», а не «сильнее по контрасту».
    'surface-void': darken(c.background, isDark ? 0.35 : 0.04),
    'surface-bg': c.background,
    'surface-s1': c.surface,
    'surface-s2': c.surfaceMuted,
    'surface-s3': c.surfaceHover,
    'surface-line': c.divider,
    'surface-hair': alpha(c.divider, isDark ? 0.6 : 0.7),
    'surface-bar': alpha(c.surface, isDark ? 0.72 : 0.82),
    'surface-selected': c.surfaceSelected,

    'ink-hi': c.text,
    /*
      ВТОРОЙ И ТРЕТИЙ УРОВЕНЬ ТЕКСТА ОГРАНИЧЕНЫ СНИЗУ.

      Порог считается не по белому, а по САМОЙ ТЁМНОЙ поверхности, на которой
      текст этого уровня встречается: `surfaceHover` — подложка фильтров и
      наведённых строк. Живой обход экрана показал ровно это: `textSecondary`
      как есть давал 4.35:1 на пилюле фильтра во флоте, хотя на панели держал
      5.48 — модель, считавшая только по белому, промах не видела.

      Поэтому на светлой теме оба уровня взяты глубже платформенного
      `textSecondary`, а не легче его: у темы проекта третий уровень выведен
      как `alpha(textSecondary, .72)`, и это 3.4:1 — ниже порога везде.
    */
    'ink-mid': isDark ? c.textSecondary : darken(c.textSecondary, 0.16),
    'ink-low': isDark ? darken(c.textSecondary, 0.09) : darken(c.textSecondary, 0.06),

    /*
      Состояния. На светлой теме взяты глубже исходных: пастель, рассчитанная
      на тёмную подложку, на белом не добирает до 4.5:1 внутри своей пилюли.
    */
    'state-ok': deep(c.success, isDark ? 0.04 : 0.12),
    'state-warn': deep(c.warning, isDark ? 0 : 0.4),
    'state-bad': deep(c.error, isDark ? 0.14 : 0.06),
    'state-info': deep(c.info, isDark ? 0.04 : 0.12),
    'state-gold': deep(c.secondary, isDark ? 0 : 0.18),

    /*
      Подложки пилюль — отдельными переменными, а не склейкой «цвет + альфа»
      строкой: с `var()` такая склейка не работает.
    */
    'state-ok-wash': alpha(deep(c.success, isDark ? 0.04 : 0.12), isDark ? 0.14 : 0.12),
    'state-warn-wash': alpha(deep(c.warning, isDark ? 0 : 0.4), isDark ? 0.14 : 0.12),
    'state-bad-wash': alpha(deep(c.error, isDark ? 0.14 : 0.06), isDark ? 0.14 : 0.12),
    'state-info-wash': alpha(deep(c.info, isDark ? 0.04 : 0.12), isDark ? 0.14 : 0.12),
    'state-gold-wash': alpha(deep(c.secondary, isDark ? 0 : 0.18), isDark ? 0.14 : 0.12),
    'state-muted-wash': alpha(c.textSecondary, isDark ? 0.14 : 0.12),

    'page-background': c.background,
    'elevation-dialog': `0 24px 60px -28px ${c.scrim}`,
    'elevation-menu': `0 12px 32px -16px ${c.scrim}`,
  } satisfies Record<string, string>;
}

const LIGHT = paletteFor('light');
const DARK = paletteFor('dark');

const ADMIN_PALETTE: Record<string, Pair> = Object.fromEntries(
  Object.keys(LIGHT).map((name) => [
    name,
    { light: LIGHT[name as keyof typeof LIGHT], dark: DARK[name as keyof typeof DARK] },
  ]),
);

/**
 * Значения переменных для режима. Ставятся ОДИН раз на `:root` — дальше всё
 * дерево, включая порталы диалогов и меню, читает те же имена.
 */
export function adminCssVars(mode: ThemeMode): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, pair] of Object.entries(ADMIN_PALETTE)) {
    vars[`--adm-${name}`] = pair[mode];
  }
  return vars;
}

const v = (name: string) => `var(--adm-${name})`;

/** Акцент платформы — синий продукта. */
export const accent = {
  main: v('accent-main'),
  light: v('accent-light'),
  soft: v('accent-soft'),
  wash: v('accent-wash'),
  washSoft: v('accent-wash-soft'),
  /** Цвет надписи на кнопке акцента. */
  onAccent: v('accent-on'),
  deep: v('accent-deep'),
  deep2: v('accent-deep-2'),
  /** Текст поверх заливки акцента (монограмма, аватар). */
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
  selected: v('surface-selected'),
} as const;

export const ink = {
  hi: v('ink-hi'),
  mid: v('ink-mid'),
  low: v('ink-low'),
} as const;

/** Состояния: одинаковые во всех таблицах консоли. */
export const state = {
  ok: v('state-ok'),
  warn: v('state-warn'),
  bad: v('state-bad'),
  info: v('state-info'),
  gold: v('state-gold'),
} as const;

export const shadow = {
  dialog: v('elevation-dialog'),
  menu: v('elevation-menu'),
} as const;

/**
 * ТИПОГРАФИКА — ШКАЛА, А НЕ ЧИСЛА ПО МЕСТУ.
 *
 * В консоли было 148 жёстких `fontSize` в тринадцати размерах (13, 12.5, 12,
 * 11.5, 11, 10.5, 10, 14, 13.5, 18, 19, 24, 26), и ни одного обращения к
 * типографике темы: дисплейный Onest, которым набраны заголовки витрины и
 * CMS, до консоли не доходил вовсе.
 *
 * Здесь шесть ролей вместо тринадцати размеров. Семейства — из токенов
 * проекта, поэтому заголовки консоли теперь набраны тем же Onest.
 */
const TYPO = DEFAULT_BRAND_TOKENS.typography;
const display = TYPO.headingFontFamily ?? TYPO.fontFamily;

export const typo = {
  /** Заголовок экрана. */
  pageTitle: {
    fontFamily: display,
    fontSize: 26,
    fontWeight: TYPO.fontWeightBold,
    letterSpacing: '-.02em',
    lineHeight: 1.2,
  },
  /** Заголовок панели внутри экрана. */
  panelTitle: {
    fontFamily: display,
    fontSize: 15,
    fontWeight: TYPO.fontWeightMedium,
    lineHeight: 1.35,
  },
  /** Крупное число в плитке сводки. */
  metric: {
    fontFamily: display,
    fontSize: 30,
    fontWeight: TYPO.fontWeightBold,
    letterSpacing: '-.02em',
    lineHeight: 1.1,
  },
  /** Основной текст: строки таблиц, значения полей. */
  body: { fontSize: 13.5, fontWeight: TYPO.fontWeightRegular, lineHeight: 1.5 },
  /** Подпись под основным текстом, вторая строка строки таблицы. */
  caption: { fontSize: 12.5, fontWeight: TYPO.fontWeightRegular, lineHeight: 1.45 },
  /** Служебная надпись: заголовок группы меню, шапка таблицы, метка. */
  label: {
    fontSize: 11,
    fontWeight: TYPO.fontWeightBold,
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    lineHeight: 1.45,
  },
} as const;

/** Геометрия — из формы токенов проекта, а не из чисел по месту. */
export const shape = {
  radius: DEFAULT_BRAND_TOKENS.shape.borderRadius,
  radiusLarge: DEFAULT_BRAND_TOKENS.shape.borderRadiusLarge,
  radiusSmall: Math.round(DEFAULT_BRAND_TOKENS.shape.borderRadius * 0.6),
  pill: 999,
} as const;

export const layout = {
  /** Та же ширина, что у панели разделов CMS: одна оболочка на два продукта. */
  nav: 248,
  /** Высота `Toolbar` MUI — шапки консоли и CMS встают на одну линию. */
  topBar: 64,
} as const;

/** Фон страницы. */
export const pageBackground = v('page-background');

/** Панель-карточка — основной контейнер консоли. */
export const panelSx = {
  bgcolor: surface.s1,
  border: `1px solid ${surface.line}`,
  borderRadius: `${shape.radiusLarge}px`,
  p: 2.25,
} as const;

/** Кнопка главного действия. */
export const primaryButtonSx = {
  bgcolor: accent.main,
  color: accent.onAccent,
  fontWeight: TYPO.fontWeightBold,
  borderRadius: `${shape.radius}px`,
  px: 2,
  boxShadow: 'none',
  '&:hover': { bgcolor: accent.light, boxShadow: 'none' },
  '&.Mui-disabled': { bgcolor: accent.wash, color: ink.low },
} as const;

/** Второстепенное действие рядом с главным. */
export const secondaryButtonSx = {
  color: ink.mid,
  borderRadius: `${shape.radius}px`,
  border: `1px solid ${surface.line}`,
  px: 2,
  '&:hover': { bgcolor: surface.s2, borderColor: surface.line },
} as const;

/** Тихое действие: «Отмена», «Назад». */
export const quietButtonSx = {
  color: ink.mid,
  borderRadius: `${shape.radius}px`,
  px: 1.5,
  '&:hover': { bgcolor: surface.s2 },
} as const;

/** Пилюля статуса. Цвет несёт смысл, а не настроение. */
export function pillSx(tone: keyof typeof state | 'muted') {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: `${shape.pill}px`,
    px: 1,
    py: 0.25,
    fontSize: 11.5,
    fontWeight: TYPO.fontWeightBold,
    whiteSpace: 'nowrap',
  } as const;
  if (tone === 'muted') {
    // Текст пилюли — второй уровень, а не третий: пилюля это подпись, которую
    // читают, и на своей подложке третий уровень не добирает до 4.5:1.
    return { ...base, bgcolor: v('state-muted-wash'), color: ink.mid };
  }
  return { ...base, bgcolor: v(`state-${tone}-wash`), color: state[tone] };
}

/**
 * ПОЛЕ ФОРМЫ — ОДНО НА ВСЮ КОНСОЛЬ.
 *
 * Поля были разной ширины в одном столбце (в «Новом отеле» — 552, 552, 552,
 * 120, 416, 326, 210), потому что каждая ширина назначалась по месту. Ширину
 * теперь задаёт сетка формы (`formGridSx` + `spanSx`), а поле всегда занимает
 * свою ячейку целиком.
 */
export const fieldSx = {
  width: '100%',
  '& .MuiOutlinedInput-root': {
    borderRadius: `${shape.radius}px`,
    bgcolor: surface.s1,
    '& fieldset': { borderColor: surface.line },
    '&:hover fieldset': { borderColor: ink.low },
    '&.Mui-focused fieldset': { borderColor: accent.main, borderWidth: '1px' },
  },
  '& .MuiInputBase-input': { ...typo.body, color: ink.hi },
  '& .MuiInputLabel-root': { ...typo.caption, color: ink.mid },
  '& .MuiInputLabel-root.Mui-focused': { color: accent.soft },
  '& .MuiFormHelperText-root': { ...typo.caption, color: ink.low, mx: 0 },
} as const;

