import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

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
        scrollMarginTop: 56,
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
export function Reveal({ children, calm }: { children: ReactNode; calm: boolean }) {
  if (calm) return <>{children}</>;
  return (
    <Box
      sx={{
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
  return (
    <Box
      data-testid={testId}
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        gap: { xs: 4, md: 7 },
        alignItems: 'center',
        direction: 'ltr',
      }}
    >
      <Box sx={{ order: { md: flip ? 2 : 1 } }}>
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
          {children ? <Box sx={{ mt: 3 }}>{children}</Box> : null}
        </Reveal>
      </Box>
      <Box sx={{ order: { md: flip ? 1 : 2 } }}>
        <Reveal calm={calm}>
          <Box
            component="img"
            src={photo}
            alt=""
            loading="lazy"
            sx={{
              width: '100%',
              aspectRatio: '4 / 3',
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
