import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import ReplayIcon from '@mui/icons-material/Replay';
import { useTranslation } from 'react-i18next';

/**
 * ИНТЕРАКТИВНАЯ СХЕМА: как движутся данные.
 *
 * Задача — объяснить устройство человеку, который его не знает. Отсюда три
 * решения.
 *
 * ШАГ ЗА РАЗ, А НЕ ВСЯ КАРТИНКА СРАЗУ. Схема из шести стрелок читается как
 * чертёж: видно всё и не понятно ничего. Здесь в каждый момент подсвечено одно
 * звено и написано ОДНО предложение про него — читатель идёт по цепочке, а не
 * разглядывает её.
 *
 * УПРАВЛЕНИЕ У ЧЕЛОВЕКА. Автопрокрутка идёт сама, но любое касание её
 * останавливает: анимация, которую нельзя остановить, заставляет догонять
 * текст, и это раздражает сильнее, чем помогает. Кнопки шагов — обычные
 * кнопки, доступные с клавиатуры.
 *
 * `prefers-reduced-motion` УВАЖАЕМ. При этой настройке автопрокрутки нет
 * вовсе: человек листает сам. Мы показываем движение данных, а не устраиваем
 * карусель.
 *
 * Рисуется всё своим SVG и CSS: библиотека схем ради двух картинок — это
 * лишние сотни килобайт на странице, которую открывают с телефона.
 */

export interface FlowStep {
  /** Ключ подписи узла: `landing.flows.<flow>.steps.<key>.title` и `.body`. */
  key: string;
  /** Что это за сторона: наша, отеля, гостя, оборудования. */
  side: 'guest' | 'platform' | 'hotel' | 'device';
}

const SIDE_COLOR: Record<FlowStep['side'], string> = {
  guest: 'primary.main',
  platform: 'secondary.main',
  hotel: 'success.main',
  device: 'warning.main',
};

const STEP_MS = 3200;

export function FlowDiagram({
  flow,
  steps,
  testId,
}: {
  flow: string;
  steps: FlowStep[];
  testId: string;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const container = useRef<HTMLDivElement | null>(null);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  /*
    Автопрокрутка стартует, только когда схему ВИДНО. Иначе к моменту, когда до
    неё долистают, она уже отыграла: человек попадает на последний шаг и не
    понимает, что это было.
  */
  useEffect(() => {
    if (reducedMotion || !container.current) return;
    const node = container.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPlaying(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reducedMotion]);

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setTimeout(() => {
      setActive((current) => {
        const next = current + 1;
        // Дошли до конца — останавливаемся на нём, а не начинаем заново:
        // бесконечная петля на странице отвлекает от текста рядом.
        if (next >= steps.length) {
          setPlaying(false);
          return current;
        }
        return next;
      });
    }, STEP_MS);
    return () => window.clearTimeout(timer.current);
  }, [playing, active, steps.length]);

  const pick = useCallback((index: number) => {
    setPlaying(false);
    setActive(index);
  }, []);

  const atEnd = active === steps.length - 1;

  return (
    <Box ref={container} data-testid={testId} sx={{ width: '100%' }}>
      {/* Цепочка узлов. Горизонтально на десктопе, вертикально на телефоне —
          стрелка вниз читается там так же однозначно, как вправо на широком. */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={0}
        alignItems="stretch"
        sx={{ mb: 2 }}
      >
        {steps.map((step, index) => (
          <Stack
            key={step.key}
            direction={{ xs: 'column', md: 'row' }}
            alignItems="center"
            sx={{ flex: 1, minWidth: 0 }}
          >
            <Box
              component="button"
              type="button"
              onClick={() => pick(index)}
              aria-current={index === active}
              data-testid={`${testId}-node-${step.key}`}
              sx={{
                flex: 1,
                minWidth: 0,
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                border: '1px solid',
                borderColor: index === active ? SIDE_COLOR[step.side] : 'divider',
                bgcolor: index === active ? 'action.hover' : 'background.paper',
                color: 'text.primary',
                borderRadius: 2,
                p: 1.5,
                transition: 'border-color .25s, background-color .25s, transform .25s',
                transform: index === active ? 'translateY(-2px)' : 'none',
                font: 'inherit',
                // Пройденные шаги не гаснут: цепочку целиком видно всегда,
                // подсвечен лишь текущий.
                opacity: index <= active ? 1 : 0.65,
              }}
            >
              <Typography variant="caption" sx={{ color: SIDE_COLOR[step.side], display: 'block' }}>
                {t(`landing.flows.sides.${step.side}`)}
              </Typography>
              <Typography variant="subtitle2" sx={{ lineHeight: 1.25 }}>
                {t(`landing.flows.${flow}.steps.${step.key}.title`)}
              </Typography>
            </Box>

            {index < steps.length - 1 ? (
              <Box
                aria-hidden
                sx={{
                  px: { xs: 0, md: 1 },
                  py: { xs: 0.5, md: 0 },
                  color: index < active ? SIDE_COLOR[steps[index + 1].side] : 'divider',
                  transition: 'color .25s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Box
                  component="svg"
                  viewBox="0 0 24 12"
                  sx={{ width: 24, height: 12, transform: { xs: 'rotate(90deg)', md: 'none' } }}
                >
                  <path d="M0 6 H18" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  <path d="M14 2 L20 6 L14 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
                </Box>
              </Box>
            ) : null}
          </Stack>
        ))}
      </Stack>

      {/* Объяснение текущего шага. Место под текст фиксировано по минимальной
          высоте: без этого страница дёргается на каждом шаге. */}
      <Box
        sx={{ minHeight: 76, mb: 1 }}
        aria-live="polite"
        data-testid={`${testId}-explanation`}
      >
        <Typography variant="body2" color="text.secondary">
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
            {t(`landing.flows.${flow}.steps.${steps[active].key}.title`)}.{' '}
          </Box>
          {t(`landing.flows.${flow}.steps.${steps[active].key}.body`)}
        </Typography>
      </Box>

      <Stack direction="row" spacing={1} alignItems="center">
        <IconButton
          size="small"
          onClick={() => (atEnd ? (setActive(0), setPlaying(true)) : setPlaying((p) => !p))}
          aria-label={t(atEnd ? 'landing.flows.replay' : playing ? 'landing.flows.pause' : 'landing.flows.play')}
          data-testid={`${testId}-play`}
        >
          {atEnd ? <ReplayIcon fontSize="small" /> : playing ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
        </IconButton>
        <Typography variant="caption" color="text.secondary">
          {t('landing.flows.step', { current: active + 1, total: steps.length })}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={() => pick(Math.max(0, active - 1))} disabled={active === 0}>
          {t('landing.flows.prev')}
        </Button>
        <Button
          size="small"
          onClick={() => pick(Math.min(steps.length - 1, active + 1))}
          disabled={atEnd}
          data-testid={`${testId}-next`}
        >
          {t('landing.flows.next')}
        </Button>
      </Stack>
    </Box>
  );
}
