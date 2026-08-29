import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { IconAirConditioner, IconCurtainOpen, IconLightGroup } from '@/icons';
import { zoneWindowStyle } from '@/guest/roomPlanMask';

/**
 * План номера на витрине — ТОТ ЖЕ ПРИЁМ, ЧТО В ПРОДУКТЕ, а не рисунок про него.
 *
 * ДВА СОВМЕЩЁННЫХ КАДРА. Снизу лежит ночной кадр, он виден всегда. Сверху —
 * светлый, показанный только в окнах тех зон, где свет включён, с растушёванным
 * краем. Свет здесь — настоящий свет с рендера, а не подложенная жёлтая заливка.
 * Кадры совмещены по построению: ночной ПОСЧИТАН из светлого
 * (`docs/design/grms-concept/bake_dark_plate.py`), поэтому на границе включённой
 * зоны не появляется двойной мебели. Нарисованный отдельно тёмный рендер этого
 * не даёт — габариты комнаты расходятся примерно на пятую часть.
 *
 * ПОЧЕМУ ПРЯМОУГОЛЬНИКИ С ПОДПИСЯМИ НЕ ГОДИЛИСЬ. Схема из подписанных
 * прямоугольников показывает, что мы придумали интерфейс; кадр показывает, что
 * у нас есть продукт. Разница видна с первого взгляда и стоила ровно того, что
 * стоит переиспользовать готовое: кадры, геометрия и маска взяты у продукта.
 *
 * ГЕОМЕТРИЯ ЛЕЖИТ ЗДЕСЬ, А НЕ ПРИЕЗЖАЕТ. У витрины правило «ноль запросов к
 * API»: спросить у платформы разметку типа номера она не может. Числа — копия
 * `docs/design/grms-concept/plan-geometry-cropped.json` под тот же кадр; кадр и
 * разметка меняются только вместе, поэтому и лежат рядом.
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
 * светом: иначе витрина встречала бы тёмной комнатой без объяснения, почему она
 * тёмная.
 */
type Zone = 'light' | 'curtains' | 'climate';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Комнаты кадра: `hit` — сама комната, `mask` — она же с запасом под растушёвку. */
const ROOMS: { code: string; hit: Rect; mask: Rect }[] = [
  { code: 'living', hit: { x: 4.3, y: 2.0, w: 43.5, h: 55.4 }, mask: { x: -1.8, y: -2.0, w: 55.7, h: 61.4 } },
  { code: 'bedroom', hit: { x: 50.0, y: 2.0, w: 45.0, h: 55.9 }, mask: { x: 43.9, y: -2.0, w: 57.2, h: 62.4 } },
  { code: 'entry', hit: { x: 23.3, y: 56.4, w: 39.6, h: 40.3 }, mask: { x: 17.2, y: 52.4, w: 51.8, h: 47.3 } },
  { code: 'wardrobe', hit: { x: 2.7, y: 58.9, w: 20.6, h: 31.2 }, mask: { x: -3.4, y: 54.9, w: 32.8, h: 39.3 } },
  { code: 'bathroom', hit: { x: 62.2, y: 58.4, w: 36.6, h: 31.2 }, mask: { x: 56.1, y: 54.4, w: 48.8, h: 39.3 } },
];

/** Окна с приводами штор. Боковое — вертикальное, полотна ездят по высоте. */
const WINDOWS: (Rect & { code: string; vertical: boolean })[] = [
  { code: 'living-top', x: 17.2, y: 1.9, w: 23.2, h: 4.8, vertical: false },
  { code: 'bed-top', x: 59.3, y: 1.9, w: 24.4, h: 4.8, vertical: false },
  { code: 'living-side', x: 4.1, y: 14.4, w: 4.4, h: 39.8, vertical: true },
];

/** Метки света — по одной на комнату, замерены по этому же кадру. */
const LIGHTS = [
  { x: 26.1, y: 29.7 },
  { x: 72.5, y: 29.9 },
  { x: 43.1, y: 76.5 },
  { x: 13.0, y: 74.5 },
  { x: 80.5, y: 74.0 },
];

/** Фанкойл: та же точка, что в разметке продукта. */
const AC = { x: 91.9, y: 29.7 };

/** Пропорция кадра. Задана заранее, иначе плита схлопывается до загрузки. */
const ASPECT = 1.056;

const COLD = 22;
const WARM = 23;

/** Свет не щёлкает кадрами — он разгорается. */
const FADE_MS = 600;

const pct = (rect: Rect) => ({
  left: `${rect.x}%`,
  top: `${rect.y}%`,
  width: `${rect.w}%`,
  height: `${rect.h}%`,
});

export function RoomPlan({ calm }: { calm: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();

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
      if (timer === null) timer = setInterval(play, 2200);
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

  /*
    ЦВЕТА МЕТОК — ЛОКАЛЬНЫЕ, И ЭТО НЕ ОБХОД ПРАВИЛА ПРО СЛОВАРЬ.

    В продукте они приезжают из словаря витрины отеля: там оформление настраивает
    отель. Здесь отеля нет вовсе, а плита лежит на фотографии — цвет считается от
    кадра, а не от темы страницы. Тема лендинга на белую метку поверх ночного
    рендера влиять не должна: в светлой теме она стала бы невидимой ровно так же,
    как когда-то значок темы на тёмной обложке.
  */
  const markerOn = theme.palette.warning.light;
  const markerOff = alpha(theme.palette.common.white, 0.6);
  const markerFill = alpha(theme.palette.common.black, 0.45);
  const move = calm ? 'none' : `all ${FADE_MS}ms ease`;

  const marker = (on: boolean) => ({
    position: 'absolute' as const,
    width: 26,
    height: 26,
    ml: '-13px',
    mt: '-13px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    pointerEvents: 'none' as const,
    border: '1px solid',
    borderColor: on ? markerOn : alpha(theme.palette.common.white, 0.35),
    bgcolor: on ? alpha(theme.palette.warning.main, 0.35) : markerFill,
    color: on ? markerOn : markerOff,
    boxShadow: on ? `0 0 16px ${alpha(theme.palette.warning.main, 0.7)}` : 'none',
    transition: move,
  });

  return (
    <Box ref={rootRef} data-testid="landing-room-plan" data-taken={taken ? 'true' : 'false'}>
      <Box
        data-light={light ? 'true' : 'false'}
        data-curtains={curtains ? 'open' : 'closed'}
        sx={{
          position: 'relative',
          width: '100%',
          aspectRatio: String(ASPECT),
          borderRadius: 3,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
          // Пока кадр грузится, на его месте не белая дыра, а тёмное поле цвета
          // ночного рендера: иначе блок мигает белым на тёмной теме.
          bgcolor: theme.palette.common.black,
        }}
      >
        {/* Ночной кадр — основа. Виден везде, где свет не включён. */}
        <Box
          component="img"
          src="/landing/room-plan-off.jpg"
          alt={t('landing.plan.alt')}
          data-testid="room-plan-base"
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />

        {/* Светлый кадр целиком — видно его только в окне зоны. */}
        {ROOMS.map((room) => (
          <Box
            key={room.code}
            component="img"
            src="/landing/room-plan-on.jpg"
            alt=""
            aria-hidden
            data-testid={`room-plan-lit-${room.code}`}
            style={{
              opacity: light ? 1 : 0,
              // В маске это не цвет, а форма прозрачности: «показать» и
              // «спрятать». Значения всё равно берутся из палитры — литералов
              // цвета в коде не заводим даже там, где цвет не виден.
              ...zoneWindowStyle(
                room.hit,
                room.mask,
                theme.palette.common.black,
                'transparent',
              ),
            }}
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              pointerEvents: 'none',
              transition: calm ? 'none' : `opacity ${FADE_MS}ms ease`,
            }}
          />
        ))}

        {/* Шторы: полотна съезжают к краям проёма, открывая его. */}
        {WINDOWS.map((window) => (
          <Box
            key={window.code}
            aria-hidden
            data-testid={`room-plan-window-${window.code}`}
            style={pct(window)}
            sx={{ position: 'absolute', overflow: 'hidden', pointerEvents: 'none' }}
          >
            {(['start', 'end'] as const).map((side) => (
              <Box
                key={side}
                style={{
                  position: 'absolute',
                  ...(window.vertical
                    ? {
                        left: 0,
                        right: 0,
                        height: '52%',
                        ...(side === 'start'
                          ? { top: 0, transformOrigin: 'center top' }
                          : { bottom: 0, transformOrigin: 'center bottom' }),
                      }
                    : {
                        top: 0,
                        bottom: 0,
                        width: '52%',
                        ...(side === 'start'
                          ? { left: 0, transformOrigin: 'left center' }
                          : { right: 0, transformOrigin: 'right center' }),
                      }),
                  transform: curtains ? (window.vertical ? 'scaleY(.2)' : 'scaleX(.2)') : 'none',
                }}
                sx={{
                  /*
                    ПОЛОТНО — ПОЛУПРОЗРАЧНОЕ И СО СКЛАДКАМИ.

                    Под ним настоящее окно с рендера: плотная белая заливка
                    читалась пластиковой панелью, приклеенной поверх кадра.
                    Складки — частые полосы поперёк движения; когда полотно
                    съезжает к краю, оно сжимается вместе с ними, и сборка
                    получается сама собой, без второй картинки на «собранное».
                  */
                  background: `repeating-linear-gradient(${
                    window.vertical ? '180deg' : '90deg'
                  }, ${alpha(theme.palette.common.white, 0.52)} 0 2px, ${alpha(
                    theme.palette.common.white,
                    0.26,
                  )} 2px 5px)`,
                  // Шторы едут заметно медленнее света: привод в номере тоже
                  // едет, а не щёлкает.
                  transition: calm ? 'none' : 'transform 1.2s cubic-bezier(.45,.05,.2,1)',
                }}
              />
            ))}
          </Box>
        ))}

        {LIGHTS.map((point) => (
          <Box
            key={`${point.x}-${point.y}`}
            aria-hidden
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
            sx={marker(light)}
          >
            <IconLightGroup size={14} />
          </Box>
        ))}

        <Box
          aria-hidden
          style={{ left: `${AC.x}%`, top: `${AC.y}%` }}
          sx={marker(climate === WARM)}
          data-testid="room-plan-ac"
        >
          <IconAirConditioner size={13} />
        </Box>

        {/*
          ЗОНЫ НАЖАТИЯ — НАСТОЯЩИЕ КНОПКИ, лежащие поверх кадра.

          Свет — две кнопки на один выключатель: комнаты на плане разнесены, и
          одним прямоугольником их не накрыть, не залезая в ванную. Это по-прежнему
          ОДНО действие, поэтому и обработчик один.
        */}
        <PlanHit
          rect={{ x: 4.3, y: 8, w: 43.5, h: 49 }}
          testId="room-plan-light"
          label={t(light ? 'landing.plan.lightOn' : 'landing.plan.light')}
          onClick={() => toggle('light')}
        />
        <PlanHit
          rect={{ x: 50, y: 8, w: 45, h: 49 }}
          testId="room-plan-light-bedroom"
          label={t(light ? 'landing.plan.lightOn' : 'landing.plan.light')}
          onClick={() => toggle('light')}
        />
        <PlanHit
          rect={{ x: 15, y: 0, w: 70, h: 8 }}
          testId="room-plan-curtains"
          label={t(curtains ? 'landing.plan.curtainsOpen' : 'landing.plan.curtains')}
          onClick={() => toggle('curtains')}
        />
        <PlanHit
          rect={{ x: 84, y: 22, w: 15, h: 16 }}
          testId="room-plan-climate"
          label={t('landing.plan.climate', { value: climate })}
          onClick={() => toggle('climate')}
        />

        {/*
          Подписи состояния — поверх кадра, в углу. На плане они нужны не для
          красоты: температура нигде на рендере не написана, а «шторы поехали»
          на маленькой плите видно не сразу.
        */}
        <Box
          data-testid="room-plan-readout"
          sx={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            display: 'flex',
            gap: 0.75,
            flexWrap: 'wrap',
          }}
        >
          <Chip on={light} icon={<IconLightGroup size={13} />} text={t(light ? 'landing.plan.lightOn' : 'landing.plan.light')} move={move} />
          <Chip
            on={curtains}
            icon={<IconCurtainOpen size={13} />}
            text={t(curtains ? 'landing.plan.curtainsOpen' : 'landing.plan.curtains')}
            move={move}
          />
          <Chip
            on={climate === WARM}
            icon={<IconAirConditioner size={13} />}
            text={t('landing.plan.climate', { value: climate })}
            move={move}
          />
        </Box>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        {t(taken ? 'landing.plan.hintTaken' : 'landing.plan.hint')}
      </Typography>
    </Box>
  );
}

/** Прозрачная кнопка над кадром: обводка появляется только под курсором. */
function PlanHit({
  rect,
  testId,
  label,
  onClick,
}: {
  rect: Rect;
  testId: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      data-testid={testId}
      aria-label={label}
      onClick={onClick}
      style={pct(rect)}
      sx={{
        position: 'absolute',
        appearance: 'none',
        p: 0,
        border: 'none',
        background: 'transparent',
        borderRadius: 2,
        cursor: 'pointer',
        transition: 'box-shadow .2s ease, background .2s ease',
        // Подсветка — только там, где есть чем наводить: на телефоне `:hover`
        // залипает на последнем нажатом элементе до следующего касания.
        '@media (hover: hover)': {
          '&:hover': {
            background: (theme) => alpha(theme.palette.common.white, 0.08),
            boxShadow: (theme) => `inset 0 0 0 2px ${alpha(theme.palette.common.white, 0.5)}`,
          },
        },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: (theme) => theme.palette.common.white,
        },
      }}
    />
  );
}

/** Подпись состояния поверх кадра. Читается на рендере, а не на теме страницы. */
function Chip({
  on,
  icon,
  text,
  move,
}: {
  on: boolean;
  icon: React.ReactNode;
  text: string;
  move: string;
}) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.25,
        borderRadius: 999,
        fontSize: 12,
        lineHeight: 1.6,
        bgcolor: (theme) => alpha(theme.palette.common.black, 0.55),
        color: (theme) => (on ? theme.palette.warning.light : alpha(theme.palette.common.white, 0.72)),
        border: '1px solid',
        borderColor: (theme) =>
          on ? alpha(theme.palette.warning.light, 0.6) : alpha(theme.palette.common.white, 0.2),
        transition: move,
      }}
    >
      {icon}
      {text}
    </Box>
  );
}
