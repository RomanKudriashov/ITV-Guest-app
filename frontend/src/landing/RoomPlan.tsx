import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

/**
 * Интерактивный план номера — то, чем продукт управляет, показанное в действии.
 *
 * ПОЧЕМУ НЕ ВИДЕО И НЕ ЗАПИСЬ СЦЕНАРИЯ. Запись — то же видео, только тяжелее в
 * поддержке: посетитель смотрит, а не трогает, и «продукт в действии» не
 * возникает. Настоящий экран номера сюда не встроить — он ходит в API, а у
 * лендинга правило «ноль запросов». Остаётся макет, который честно говорит, что
 * он макет, и при этом отзывается на нажатие.
 *
 * АВТОВОСПРОИЗВЕДЕНИЕ И ПЕРЕДАЧА В РУКИ. План играет сам по кругу, пока его не
 * тронули: человек, пролиставший мимо, ничего не нажмёт и не узнает, что план
 * живой. Первое же касание останавливает показ НАВСЕГДА — дальше состоянием
 * распоряжается посетитель. Возобновлять после паузы нельзя: экран, который
 * перехватывает управление обратно, воспринимается как сломанный.
 *
 * Играет только пока виден: `IntersectionObserver` вместо вечного таймера.
 *
 * При `prefers-reduced-motion` автопоказа нет вовсе, а план стоит со включённым
 * светом и подписью, что нажатие меняет состояние: иначе он выглядел бы просто
 * тёмной картинкой.
 */
type Zone = 'light' | 'curtains' | 'climate';

const COLD = 22;
const WARM = 23;

export function RoomPlan({ calm }: { calm: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';

  const [light, setLight] = useState(calm);
  const [curtains, setCurtains] = useState(false);
  const [climate, setClimate] = useState(COLD);
  /** Тронули — показ больше не идёт. Обратного пути нет намеренно. */
  const [taken, setTaken] = useState(calm);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const take = useCallback(() => setTaken(true), []);

  const toggle = (zone: Zone) => {
    take();
    if (zone === 'light') setLight((on) => !on);
    if (zone === 'curtains') setCurtains((open) => !open);
    if (zone === 'climate') setClimate((value) => (value === COLD ? WARM : COLD));
  };

  useEffect(() => {
    if (taken || calm) return undefined;
    const node = rootRef.current;
    if (!node) return undefined;

    let step = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    const play = () => {
      // Круг: свет → шторы → климат → всё обратно. Медленно, чтобы успеть
      // прочитать, что именно изменилось.
      step = (step + 1) % 4;
      setLight(step >= 1);
      setCurtains(step >= 2);
      setClimate(step >= 3 ? WARM : COLD);
    };
    const start = () => {
      if (timer === null) timer = setInterval(play, 1800);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };

    const observer = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? start() : stop()),
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => {
      stop();
      observer.disconnect();
    };
  }, [taken, calm]);

  const ink = theme.palette.text.secondary;
  const line = theme.palette.divider;
  const surface = theme.palette.brand.surfaceMuted;
  const glow = theme.palette.warning.main;
  const move = calm ? 'none' : 'all .55s cubic-bezier(.4,0,.2,1)';

  return (
    <Box ref={rootRef} data-testid="landing-room-plan" data-taken={taken ? 'true' : 'false'}>
      <Box
        component="svg"
        viewBox="0 0 420 300"
        role="img"
        aria-label={t('landing.plan.alt')}
        sx={{
          width: '100%',
          display: 'block',
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <defs>
          <radialGradient id="room-plan-glow">
            <stop offset="0" stopColor={glow} stopOpacity={dark ? 0.5 : 0.32} />
            <stop offset="1" stopColor={glow} stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x="18" y="18" width="384" height="264" rx="12" fill={surface} stroke={line} />

        {/* Свечение лампы — под мебелью, как настоящий свет в комнате. */}
        <circle
          cx="86"
          cy="200"
          r={light ? 92 : 0}
          fill="url(#room-plan-glow)"
          style={{ transition: move }}
        />

        <rect x="40" y="46" width="152" height="98" rx="10" fill={theme.palette.background.paper} stroke={line} />
        <text x="116" y="100" fill={ink} fontSize="12" textAnchor="middle">
          {t('landing.plan.bed')}
        </text>

        {/* Окно и штора: панель уезжает вправо, открывая проём. */}
        <rect x="212" y="46" width="170" height="62" rx="10" fill={theme.palette.background.paper} stroke={line} />
        <rect
          x="214"
          y="48"
          width={curtains ? 40 : 166}
          height="58"
          rx="9"
          fill={alpha(theme.palette.text.primary, dark ? 0.5 : 0.16)}
          style={{ transition: move }}
        />
        <text x="297" y="82" fill={ink} fontSize="12" textAnchor="middle">
          {t(curtains ? 'landing.plan.curtainsOpen' : 'landing.plan.curtains')}
        </text>

        {/* Зоны нажатия — настоящие кнопки, а не декорация. */}
        <g
          onClick={() => toggle('light')}
          data-testid="room-plan-light"
          style={{ cursor: 'pointer' }}
        >
          <circle
            cx="86"
            cy="200"
            r="19"
            fill={light ? glow : theme.palette.background.paper}
            stroke={light ? glow : line}
            style={{ transition: move }}
          />
          <text x="86" y="238" fill={light ? glow : ink} fontSize="11" textAnchor="middle">
            {t(light ? 'landing.plan.lightOn' : 'landing.plan.light')}
          </text>
        </g>

        <g onClick={() => toggle('curtains')} data-testid="room-plan-curtains" style={{ cursor: 'pointer' }}>
          <rect x="212" y="46" width="170" height="62" rx="10" fill="transparent" />
        </g>

        <g onClick={() => toggle('climate')} data-testid="room-plan-climate" style={{ cursor: 'pointer' }}>
          <rect x="212" y="172" width="170" height="54" rx="10" fill={theme.palette.background.paper} stroke={line} />
          <text x="297" y="205" fill={ink} fontSize="13" textAnchor="middle">
            {t('landing.plan.climate', { value: climate })}
          </text>
        </g>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        {t(taken ? 'landing.plan.hintTaken' : 'landing.plan.hint')}
      </Typography>
    </Box>
  );
}
