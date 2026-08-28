import type { Theme } from '@mui/material/styles';
import { createTheme } from '@mui/material/styles';

/**
 * ШКАЛА РАЗМЕРОВ ДЛЯ ПОВЕРХНОСТЕЙ ПЕРСОНАЛА — одна на консоль, CMS и трекер.
 *
 * ЗАЧЕМ ШКАЛА, А НЕ ПРАВКА ПО ЭКРАНАМ. Размеры расползались потому, что их
 * задавали на месте: каждый экран решал сам, и «крупно» накапливалось по
 * одному `sx` за раз. Правка по экранам вернула бы то же состояние к
 * следующему разделу. Здесь величина названа один раз, и экран берёт её, а не
 * придумывает.
 *
 * ОТКУДА ВЗЯЛИСЬ ЧИСЛА. Опора — размер основного текста, 14px. Всё остальное
 * отсчитывается от него небольшими шагами (≈1.15), поэтому лестница получается
 * пологой: соседние ступени различимы, но ни одна не кричит.
 *
 *     12  подпись, вспомогательная строка
 *     13  плотный текст: таблицы, списки, чипы
 *     14  ОСНОВНОЙ ТЕКСТ — опора шкалы
 *     16  заголовок карточки, крупное число в счётчике
 *     18  заголовок экрана
 *     22  единственное число, которое читают издалека (сводка смены)
 *
 * ПОЧЕМУ 14, А НЕ 16. Было 18.29px — и это не чьё-то решение, а ловушка MUI:
 * `typography.fontSize` не пиксели, а база, которую MUI умножает на
 * коэффициент `fontSize / 14`. В токенах стояло 16, и весь интерфейс персонала
 * оказался на 14% крупнее, чем задумывалось, — включая то, что задавали
 * вручную «по месту» уже поверх раздутого основания.
 *
 * ВЫСОТЫ ЭЛЕМЕНТОВ УПРАВЛЕНИЯ отсчитываются не от кнопки, а от строки текста:
 *
 *     row     30  поле ввода и выпадающий список — строка плюс рамка
 *     button  32  обычное действие
 *     lead    40  единственное главное действие экрана
 *
 * Поле ввода и список раньше были 43px — выше кнопки. Форма из шести полей
 * занимала экран, хотя в ней шесть строк текста.
 *
 * ЦЕЛЬ НАЖАТИЯ РАЗВЕДЕНА С РАЗМЕРОМ — см. `touchTarget`.
 */
export const density = {
  /** Ступени шрифта. Имена по назначению, а не по величине. */
  font: {
    caption: 12,
    dense: 13,
    body: 14,
    strong: 16,
    title: 18,
    figure: 22,
  },
  /** Высоты элементов управления. */
  control: {
    row: 30,
    button: 32,
    lead: 40,
  },
  /** Внутренние отступы поверхностей. */
  pad: {
    tight: 8,
    card: 12,
    section: 16,
  },
  /** Минимальная цель нажатия. Не размер элемента, а площадь под пальцем. */
  touch: 44,
} as const;

/**
 * Расширить область нажатия, НЕ увеличивая сам элемент.
 *
 * Доска трекера — рабочее место у плиты, и палец там толстый: цель меньше
 * 44px промахивается. Но плотность нужна ровно там же — повару важно видеть
 * много карточек разом, а не три крупные.
 *
 * Разведено так: видимый размер задаёт шкала, а площадь под пальцем добирает
 * прозрачный слой поверх элемента. Он выходит за границы кнопки и ловит
 * промах, ничего не сдвигая в раскладке — `position: absolute` не участвует в
 * потоке. Пиксели, которые видит глаз, и пиксели, которые ловят палец, — разные
 * величины, и путать их не обязательно.
 */
export function touchTarget(size: number = density.touch) {
  return {
    position: 'relative' as const,
    '&::after': {
      content: '""',
      position: 'absolute' as const,
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      minWidth: size,
      minHeight: size,
      width: '100%',
      height: '100%',
    },
  };
}

/**
 * Тема персонала: та же палитра и тот же бренд, другой масштаб.
 *
 * Отдельная тема, а не правка общей, потому что общую делит ГОСТЬ. У него
 * крупное оправдано: телефон, одна рука, чужое приложение впервые в жизни.
 * Сжав основание, мы сжали бы и его — поэтому шкала накрывает только те три
 * поверхности, где сидят за работой.
 */
export function compactTheme(base: Theme): Theme {
  const { font, control, pad } = density;
  const px = (value: number) => `${value}px`;

  return createTheme(base, {
    typography: {
      // Пиксели, а не rem: коэффициент MUI уже однажды раздул интерфейс на
      // 14%, и повторять эту арифметику в шкале незачем.
      body1: { fontSize: px(font.body) },
      body2: { fontSize: px(font.dense) },
      subtitle1: { fontSize: px(font.body), fontWeight: 600 },
      subtitle2: { fontSize: px(font.dense), fontWeight: 600 },
      caption: { fontSize: px(font.caption) },
      button: { fontSize: px(font.dense) },
      h6: { fontSize: px(font.strong) },
      h5: { fontSize: px(font.title) },
      h4: { fontSize: px(font.figure) },
    },
    components: {
      MuiButton: {
        defaultProps: { size: 'small' },
        styleOverrides: {
          root: { minHeight: control.button, paddingTop: 4, paddingBottom: 4 },
          sizeLarge: { minHeight: control.lead },
        },
      },
      MuiOutlinedInput: {
        // Поле и список — по строке текста, а не по кнопке.
        styleOverrides: {
          root: { fontSize: px(font.body) },
          input: { paddingTop: 6, paddingBottom: 6, minHeight: control.row - 12 },
        },
      },
      MuiInputLabel: { styleOverrides: { root: { fontSize: px(font.body) } } },
      MuiSelect: { defaultProps: { size: 'small' } },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiFormControl: { defaultProps: { size: 'small' } },
      MuiMenuItem: { styleOverrides: { root: { fontSize: px(font.body), minHeight: control.row } } },
      MuiChip: {
        defaultProps: { size: 'small' },
        styleOverrides: { root: { fontSize: px(font.caption) } },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { fontSize: px(font.dense), paddingTop: 6, paddingBottom: 6 },
        },
      },
      MuiCardContent: {
        styleOverrides: {
          root: { padding: pad.card, '&:last-child': { paddingBottom: pad.card } },
        },
      },
      MuiTab: { styleOverrides: { root: { fontSize: px(font.dense), minHeight: control.lead } } },
      MuiToggleButton: {
        defaultProps: { size: 'small' },
        styleOverrides: { root: { fontSize: px(font.dense), minHeight: control.button } },
      },
      MuiIconButton: {
        defaultProps: { size: 'small' },
        // Иконки сжимаются вместе со всем, но палец не худеет: площадь под
        // ним добирается прозрачным слоем.
        styleOverrides: { root: { ...touchTarget() } },
      },
    },
  });
}
