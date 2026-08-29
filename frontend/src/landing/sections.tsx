import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

import { NAV_HEIGHT } from './nav';

/**
 * Строительные блоки лендинга: экран во весь рост, фотофон, цветной блок.
 *
 * ДВИЖЕНИЕ СДЕРЖАННОЕ И ВЫКЛЮЧАЕМОЕ. Появление снизу на несколько пикселей и
 * ничего больше: лендинг продаёт систему для работы, а не аттракцион. Всё
 * движение снято при `prefers-reduced-motion` — не «ослаблено», а именно
 * снято: человек, включивший этот режим, обычно включил его не из вкуса.
 *
 * ТЁМНАЯ ТЕМА НАРАВНЕ СО СВЕТЛОЙ. Ни одного цвета мимо палитры: фон секций
 * берётся из темы, скрим над фотографией считается от неё же. Поэтому светлая
 * не выбеливает кадр, а тёмная не топит его в черноте.
 */

/** Уважать ли просьбу не двигать. Хук, а не проверка на месте: нужен многим. */
export function useCalm(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/**
 * Экран во весь рост с воздухом.
 *
 * `100dvh`, а не `100vh`: на телефоне адресная строка съезжает, и `vh` даёт
 * прыжок высоты в момент прокрутки — ровно там, где мы обещали сдержанность.
 */
export function Screen({
  children,
  tone = 'default',
  id,
  testId,
  full = true,
}: {
  children: ReactNode;
  /** Заливка: обычный фон, приглушённый или акцентный блок. */
  tone?: 'default' | 'muted' | 'accent';
  id?: string;
  testId?: string;
  full?: boolean;
}) {
  const theme = useTheme();
  const bg =
    tone === 'accent'
      ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.08)
      : tone === 'muted'
        ? theme.palette.brand.surfaceMuted
        : theme.palette.background.default;

  return (
    <Box
      id={id}
      data-testid={testId}
      component="section"
      sx={{
        bgcolor: bg,
        minHeight: full ? { xs: 'auto', md: '100dvh' } : 'auto',
        display: 'flex',
        alignItems: 'center',
        py: { xs: 7, md: 12 },
        position: 'relative',
        overflow: 'hidden',
        // Переход по якорю не должен прятать заголовок под липкой полосой.
        scrollMarginTop: `${NAV_HEIGHT + 12}px`,
      }}
    >
      <Container maxWidth="lg" sx={{ position: 'relative' }}>
        {children}
      </Container>
    </Box>
  );
}

/**
 * Появление при прокрутке — только через CSS, без наблюдателей и без состояния.
 *
 * `animation-timeline: view()` двигает элемент, пока он входит в кадр, и не
 * стоит ни одного кадра JS. Там, где браузер этого не умеет, элемент просто
 * стоит на месте — не «сломано», а «без движения», что здесь допустимо.
 */
export function Reveal({
  children,
  calm,
  fill = false,
}: {
  children: ReactNode;
  calm: boolean;
  /**
   * Занять всю высоту родителя.
   *
   * Появление добавляет СВОЙ слой между ячейкой сетки и картинкой, и растяжка
   * на нём обрывается: ячейка высоту ряда знает, а картинка внутри — уже нет.
   * Признак нужен только там, где картинка тянется по ряду, поэтому он не
   * умолчание: обычному тексту лишний `display: flex` ни к чему.
   */
  fill?: boolean;
}) {
  if (calm) return <>{children}</>;
  return (
    <Box
      sx={{
        ...(fill ? { display: 'flex', flex: 1, minWidth: 0 } : null),
        '@supports (animation-timeline: view())': {
          animation: 'landing-rise linear both',
          animationTimeline: 'view()',
          animationRange: 'entry 0% cover 30%',
        },
        '@keyframes landing-rise': {
          from: { opacity: 0, transform: 'translateY(18px)' },
          to: { opacity: 1, transform: 'none' },
        },
      }}
    >
      {children}
    </Box>
  );
}

/**
 * Фотография на весь экран с текстом поверх.
 *
 * Скрим обязателен: белый текст поверх произвольного кадра нечитаем, и это не
 * вопрос вкуса — кадр может смениться. Затемнение идёт снизу, оттуда же, где
 * текст, чтобы верх фотографии остался фотографией.
 */
export function PhotoHero({
  src,
  children,
  calm,
  testId,
  overlay,
}: {
  src: string;
  children: ReactNode;
  calm: boolean;
  testId?: string;
  /** Слой между скримом и текстом: частицы. */
  overlay?: ReactNode;
}) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const scrim = theme.palette.brand.scrim;

  return (
    <Box
      data-testid={testId}
      component="section"
      sx={{
        position: 'relative',
        minHeight: { xs: '86dvh', md: '100dvh' },
        display: 'flex',
        alignItems: 'flex-end',
        overflow: 'hidden',
        // Текст поверх фотографии — из палитры, а не литералом: словарь цветов
        // на то и заведён, чтобы тема могла его переопределить.
        color: theme.palette.common.white,
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${src})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          // Сдержанный параллакс: фон уходит медленнее страницы. При просьбе
          // не двигать — обычная фотография.
          ...(calm ? {} : { backgroundAttachment: { xs: 'scroll', md: 'fixed' } }),
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          // Скрим считается от токена затемнения темы: светлая не выбеливает
          // кадр, тёмная не топит его в черноте.
          background: `linear-gradient(180deg, ${alpha(scrim, dark ? 0.5 : 0.3)} 0%, ${alpha(
            scrim,
            dark ? 0.88 : 0.78,
          )} 78%)`,
        }}
      />
      {overlay}
      <Container maxWidth="lg" sx={{ position: 'relative', pb: { xs: 7, md: 12 } }}>
        {children}
      </Container>
    </Box>
  );
}

/**
 * Цветной блок: фотография с одной стороны, текст и снимок интерфейса с другой.
 *
 * Пришёл на смену ряду одинаковых карточек на светлом. Карточка описывает —
 * блок показывает; на витрине это разные вещи.
 *
 * КАРТИНКИ БЛОКА СТОЯТ НА ОДНОЙ ЛИНИИ, и держит её сетка, а не подбор отступов.
 *
 * Раньше блок был одним рядом из двух колонок с `alignItems: center`: колонка с
 * текстом и снимком центровалась отдельно от колонки с фотографией, и верхние
 * края расходились ровно на половину разницы их высот — от 21 до 91 пикселя,
 * причём в каждом блоке по-своему, потому что снимки разной высоты. Это не
 * лечится отступом: разница зависит от длины заголовка, а он переводится на
 * четыре языка.
 *
 * Теперь рядов ДВА: текст занимает верхний, обе картинки — нижний. Верхняя линия
 * у них общая по построению, и её не сдвинет ни длинный перевод, ни другой
 * снимок. Фотография тянется на всю высоту ряда, поэтому у картинок совпадает и
 * нижний край.
 *
 * Снимка может не быть — тогда рядов снова один, и фотография занимает его
 * целиком: пустой ряд высотой в ноль оставил бы от неё полоску.
 *
 * НА УЗКОМ ЭКРАНЕ РЯДОВ НЕТ ВОВСЕ. Колонка одна, и всё идёт потоком: текст,
 * снимок, фотография. Выравнивать там нечего — картинки и так одна под другой, —
 * а привязка к номерам рядов дала бы дыры на месте несуществующей второй
 * колонки.
 */
export function SplitBlock({
  photo,
  eyebrow,
  title,
  body,
  children,
  flip = false,
  calm,
  testId,
}: {
  photo: string;
  eyebrow: string;
  title: string;
  body: string;
  /** Снимок интерфейса — часть блока, а не отдельный ряд. */
  children?: ReactNode;
  flip?: boolean;
  calm: boolean;
  testId?: string;
}) {
  // Сторона текста и сторона фотографии. Задаём КОЛОНКОЙ, а не порядком:
  // порядок в сетке с явными рядами уже ничего не решает.
  const textColumn = flip ? 2 : 1;
  const photoColumn = flip ? 1 : 2;

  return (
    <Box
      data-testid={testId}
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        columnGap: { md: 7 },
        rowGap: { xs: 4, md: 3 },
        direction: 'ltr',
      }}
    >
      <Box sx={{ gridColumn: { md: textColumn }, gridRow: { md: 1 } }}>
        <Reveal calm={calm}>
          <Typography variant="overline" color="primary" sx={{ letterSpacing: '.12em' }}>
            {eyebrow}
          </Typography>
          <Typography variant="h3" component="h2" sx={{ mt: 1, mb: 2 }}>
            {title}
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: 18, lineHeight: 1.5 }}>
            {body}
          </Typography>
        </Reveal>
      </Box>

      {children ? (
        <Box
          data-testid={testId ? `${testId}-shot` : undefined}
          sx={{ gridColumn: { md: textColumn }, gridRow: { md: 2 }, alignSelf: 'start' }}
        >
          <Reveal calm={calm}>{children}</Reveal>
        </Box>
      ) : null}

      <Box
        data-testid={testId ? `${testId}-photo` : undefined}
        sx={{
          gridColumn: { md: photoColumn },
          // Снимка нет — фотографии нечего догонять, и она занимает оба ряда.
          gridRow: { md: children ? 2 : '1 / span 2' },
          alignSelf: 'stretch',
          // Растяжка работает, только если ей есть во что растягиваться: ячейка
          // сетки высоту ряда наследует, а вот `<img>` внутри неё — нет.
          display: 'flex',
        }}
      >
        <Reveal calm={calm} fill>
          <Box
            component="img"
            src={photo}
            alt=""
            loading="lazy"
            sx={{
              width: '100%',
              // На узком экране высоту задаёт пропорция: ряда, к которому можно
              // подстроиться, там нет. На широком — высота ряда, то есть высота
              // снимка вместе с его подписью.
              aspectRatio: { xs: '4 / 3', md: 'auto' },
              height: { xs: 'auto', md: '100%' },
              objectFit: 'cover',
              borderRadius: 3,
              display: 'block',
            }}
          />
        </Reveal>
      </Box>
    </Box>
  );
}
