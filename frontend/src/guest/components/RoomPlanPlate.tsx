import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTranslation } from 'react-i18next';

import { useStorefront } from '../useStorefront';
import type { RoomPlan, RoomPlanPoint, RoomPlanRect, RoomPlanWindow } from '../api/types';
import { surfaceRadius } from '../storefrontTokens';

/**
 * План-двойник номера: ДВА СОВМЕЩЁННЫХ КАДРА, следующих ПОДТВЕРЖДЁННОМУ
 * состоянию.
 *
 * Нижний слой — ночной кадр, он виден всегда. Верхний — светлый, показанный
 * только в тех зонах, где свет подтверждённо включён; края зоны растушёваны,
 * поэтому свет не обрывается по прямой, которой в комнате нет. Зона выключена —
 * сквозь неё видна настоящая тёмная комната, а не дневная под серой плёнкой.
 * Глобального затемнения и вуалей поверх кадра здесь нет.
 *
 * Совмещение — условие работы, а не пожелание: разойдись кадры на несколько
 * пикселей, и на границе включённой зоны появится двойная мебель. Поэтому
 * ночной кадр СЧИТАЕТСЯ из светлого (docs/design/grms-concept/bake_dark_plate.py)
 * и совмещён по построению. Нарисованный отдельно тёмный рендер этого не даёт:
 * при одинаковом кадре 1586×992 габариты комнаты расходятся примерно на 21%
 * (светлый x 310–1260, тёмный x 217–1365).
 *
 * Ночного кадра может не быть (`image_off` пуст) — тогда плита падает назад на
 * прежнее поведение: один кадр и затемняющая маска по выключенной зоне. Хуже на
 * вид, но честно, и новый тип номера подключается без ночного рендера.
 *
 * Ни одной цифры геометрии здесь нет: всё приезжает в `plan` из опубликованной
 * конфигурации типа. Новый тип номера с другим рендером подключается правкой
 * конфигурации, а не этого файла. Цвета — из `roomPlan` словаря витрины,
 * включая те, которыми рисует канвас.
 *
 * RTL: плита НЕ зеркалится. Это физическая комната, а не раскладка — ванная не
 * переезжает налево оттого, что интерфейс на арабском. Поэтому геометрия
 * ставится ИНЛАЙНОВЫМИ стилями: emotion в RTL проходит через stylis-plugin-rtl,
 * который меняет `left` на `right`, а инлайновый стиль он не трогает.
 */

/**
 * Разлёт света из окна — свойство СВЕТА, а не комнаты, поэтому считается от
 * рамы, а не приезжает из конфигурации. Свет разливается только внутрь.
 */
const SPILL = { along: 3, depth: 3.2, sideDepth: 4.5 } as const;

/** Переключение зоны — плавное: свет в комнате не щёлкает кадрами. */
const ZONE_FADE_MS = 600;

/** Плотность потока по скорости вентилятора: 0 — потока нет вовсе. */
const AIRFLOW_DENSITY = [0, 7, 13, 21] as const;

export interface PlanReading {
  title: string;
  /**
   * Подтверждённое состояние. `null` — НЕ ЧИТАЕТСЯ, и это не то же самое, что
   * «выключено»: показать любое из двух здесь означало бы соврать.
   */
  on: boolean | null;
  /** Скорость вентилятора для точки воздуха. */
  fan: number | null;
  /** Идёт обмен: зона показывает это, но не переключается. */
  pending: boolean;
  disabled: boolean;
}

export interface RoomPlanPlateProps {
  plan: RoomPlan;
  readings: Record<string, PlanReading>;
  /** Состояний нет вовсе: плита нейтральна и не кликабельна. */
  neutral?: boolean;
  /**
   * Масштаб липкой плиты при скролле: 1 — во всю ширину колонки.
   *
   * Именно МАСШТАБ, а не ширина. Ширина меняет высоту плиты (у неё задано
   * соотношение сторон), высота плиты — высоту документа, а браузер на смену
   * высоты документа поправляет позицию скролла. Поправка запускала пересчёт
   * заново, и экран начинал трястись. `transform` не трогает раскладку вовсе:
   * место под плиту остаётся зарезервированным, меняется только картинка.
   */
  scale?: number;
  onToggle: (controlId: string, next: number) => void;
}

/**
 * Окно зоны на светлом кадре: эллипс, вписанный в прямоугольник зоны.
 *
 * Проценты радиусов считаются от кадра, а кадр лежит ровно на плите — поэтому
 * окно садится на комнату без пересчётов и без вложенного масштабирования.
 * Инлайновым стилем, как и вся геометрия: в RTL emotion развернул бы позицию.
 */
const zoneWindow = (rect: RoomPlanRect, stops: string): CSSProperties => {
  const gradient =
    `radial-gradient(${rect.w / 2}% ${rect.h / 2}% at ` +
    `${rect.x + rect.w / 2}% ${rect.y + rect.h / 2}%, ${stops})`;
  return {
    maskImage: gradient,
    WebkitMaskImage: gradient,
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
  };
};

const pct = (rect: RoomPlanRect) => ({
  left: `${rect.x}%`,
  top: `${rect.y}%`,
  width: `${rect.w}%`,
  height: `${rect.h}%`,
});

export function RoomPlanPlate({
  plan,
  readings,
  neutral = false,
  scale = 1,
  onToggle,
}: RoomPlanPlateProps) {
  const { t } = useTranslation();
  const { roomPlan: tokens } = useStorefront();
  const calm = useMediaQuery('(prefers-reduced-motion: reduce)');

  // Пропорция приезжает с сервером и нужна ДО загрузки кадра: без неё плита
  // схлопывается в ноль, а потом прыгает на высоту картинки — ровно в тот
  // момент, когда гость уже читает список под ней.
  if (!plan.image || !plan.aspect) return null;

  const read = (controlId: string): PlanReading | undefined =>
    neutral ? undefined : readings[controlId];

  const lit = plan.zones.filter((zone) => read(zone.controlId)?.on === true).length;
  const off = plan.zones.filter((zone) => read(zone.controlId)?.on === false).length;
  const motion = calm ? 'none' : undefined;

  // Два кадра или один с маской — решает НАЛИЧИЕ ночного кадра, а не тип
  // номера и не тема: без него плита обязана работать по-прежнему.
  const twoFrames = Boolean(plan.image_off);
  // Глобальное затемнение живёт только в запасном режиме. С двумя кадрами оно
  // не нужно и вредно: тёмное — это сам ночной кадр, а не плёнка поверх.
  const dim = twoFrames || !plan.zones.length ? 0 : (0.5 * off) / plan.zones.length;

  return (
    <Box
      data-testid="room-plan"
      data-lit={neutral ? 'unknown' : String(lit)}
      data-mirrored={plan.mirrored ? 'true' : undefined}
      style={{
        aspectRatio: String(plan.aspect),
        // Зеркальная планировка отражает плиту ЦЕЛИКОМ — кадры вместе с
        // геометрией и хит-зонами. Отражать координаты по отдельности значило
        // бы завести второй источник истины, который разойдётся с первым.
        // К RTL это отношения не имеет: там плита не зеркалится никогда.
        transform:
          [scale === 1 ? '' : `scale(${scale})`, plan.mirrored ? 'scaleX(-1)' : '']
            .filter(Boolean)
            .join(' ') || undefined,
        transformOrigin: 'top center',
      }}
      sx={{
        position: 'relative',
        width: '100%',
        mx: 'auto',
        maxWidth: '100%',
        overflow: 'hidden',
        borderRadius: (theme) => surfaceRadius.panel(theme.palette.brand.radius),
        border: tokens.frame,
        boxShadow: tokens.shadow,
        background: tokens.fallback,
        // Плавности здесь НЕТ намеренно: масштаб пересчитывается каждый кадр от
        // позиции скролла, и переход поверх него дал бы отставание картинки от
        // пальца — то самое «плывёт», которое читается как тормоза.
        willChange: 'transform',
      }}
    >
      {/*
        Кадры ДЕКОРАТИВНЫ: управление живёт в кнопках зон и, полностью, в
        списке контролов рядом. Описывать словами картинку комнаты нечем.

        Нижний слой — ночной, если он есть. Нет ночного — снизу лежит светлый,
        и выключенные зоны накрываются маской, как раньше.
      */}
      <Box
        component="img"
        src={twoFrames ? plan.image_off : plan.image}
        alt=""
        aria-hidden
        data-testid="room-plan-base"
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          // Плита без ночного кадра в недоступности обесцвечивается: иначе
          // снизу остался бы СВЕТЛЫЙ кадр, то есть «во всём номере горит
          // свет» — ровно то враньё, которого здесь быть не должно. С ночным
          // кадром обесцвечивать нечего: он и есть нейтральное состояние.
          filter: neutral && !twoFrames ? 'grayscale(1)' : 'none',
        }}
      />

      {plan.zones.map((zone) => {
        const on = read(zone.controlId)?.on === true;
        return twoFrames ? (
          /*
            Верхний, светлый кадр — ЦЕЛИКОМ поверх нижнего, а видно его только
            в окне зоны: окно вырезано маской-эллипсом, вписанным в
            прямоугольник зоны, с растушёванным краем.

            Именно так, а не «окошко с overflow: hidden и уменьшенной копией
            кадра внутри»: на живом iOS сочетание маски и обрезки контейнера
            даёт жёсткий прямоугольник — маска теряется, остаётся клип, и плита
            выглядит сломанной. Здесь обрезки нет вовсе, а кадр не масштабируется
            и потому совпадает с нижним пиксель в пиксель по построению.
          */
          <Box
            key={`lit-${zone.code || zone.controlId}`}
            component="img"
            src={plan.image}
            alt=""
            aria-hidden
            data-testid={`room-plan-lit-${zone.code || zone.controlId}`}
            style={{ opacity: on ? 1 : 0, ...zoneWindow(zone.mask, tokens.zoneWindowStops) }}
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              pointerEvents: 'none',
              transition: motion ?? `opacity ${ZONE_FADE_MS}ms ease`,
            }}
          />
        ) : (
          <Box
            key={`mask-${zone.code || zone.controlId}`}
            aria-hidden
            style={{ ...pct(zone.mask), opacity: read(zone.controlId)?.on === false ? 1 : 0 }}
            sx={{
              position: 'absolute',
              pointerEvents: 'none',
              background: tokens.maskOff,
              transition: motion ?? `opacity ${ZONE_FADE_MS}ms ease`,
            }}
          />
        );
      })}

      <Box
        aria-hidden
        style={{ opacity: dim }}
        sx={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: tokens.dim,
          transition: motion ?? 'opacity .7s ease',
        }}
      />

      {plan.windows.map((window) => (
        <PlanWindow
          key={window.code}
          window={window}
          curtain={read(window.curtainId)?.on ?? null}
          blackout={window.blackoutId ? (read(window.blackoutId)?.on ?? null) : undefined}
          calm={calm}
        />
      ))}

      <Airflow points={plan.points} readings={neutral ? {} : readings} tint={tokens.airflowTint} calm={calm} />

      {plan.zones.map((zone) => {
        const reading = read(zone.controlId);
        const on = reading?.on ?? null;
        const unknown = on === null;
        const state = unknown
          ? t('guest.roomControl.offline')
          : on
            ? t('guest.roomControl.on')
            : t('guest.roomControl.off');
        return (
          <Box
            component="button"
            type="button"
            key={`hit-${zone.code || zone.controlId}`}
            data-testid={`room-plan-zone-${zone.code || zone.controlId}`}
            disabled={unknown || Boolean(reading?.disabled)}
            aria-busy={reading?.pending || undefined}
            // Состояния нет — нет и `aria-pressed`: то же правило, по которому
            // сцена никогда не показывается включённой.
            aria-pressed={unknown ? undefined : on}
            aria-label={`${reading?.title ?? t('guest.roomControl.planZone')}: ${state}`}
            onClick={() => onToggle(zone.controlId, on ? 0 : 1)}
            style={pct(zone.hit)}
            sx={{
              position: 'absolute',
              appearance: 'none',
              padding: 0,
              border: 'none',
              cursor: 'pointer',
              background: reading?.pending ? tokens.zonePending : 'transparent',
              borderRadius: (theme) => surfaceRadius.inner(theme.palette.brand.radius),
              transition: motion ?? 'background .25s ease',
              '&:hover:not(:disabled)': { background: tokens.zoneHover },
              '&:disabled': { cursor: 'default' },
            }}
          />
        );
      })}

      {/*
        Зона, состояние которой не читается, накрывается НЕЙТРАЛЬНОЙ вуалью, а
        не маской: маска означает «свет выключен», и подставить её здесь значит
        ответить на вопрос, ответа на который у нас нет.
      */}
      {plan.zones.map((zone) =>
        read(zone.controlId)?.on === null || (!neutral && !readings[zone.controlId]) ? (
          <Box
            key={`unknown-${zone.code || zone.controlId}`}
            aria-hidden
            style={pct(zone.hit)}
            sx={{
              position: 'absolute',
              pointerEvents: 'none',
              background: tokens.unknown,
              borderRadius: (theme) => surfaceRadius.inner(theme.palette.brand.radius),
            }}
          />
        ) : null,
      )}

      {neutral ? (
        <Box
          data-testid="room-plan-neutral"
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            p: 3,
            // С ночным кадром закрывать нечего: он и есть нейтральное
            // состояние, и плотная заливка сделала бы из комнаты чёрный
            // прямоугольник. Без него под плашкой лежит СВЕТЛЫЙ кадр, и его
            // приходится закрывать всерьёз.
            background: twoFrames ? tokens.offlineHint : tokens.offlineVeil,
          }}
        >
          {/*
            Коротко. Полный текст с адресом на ресепшен уже стоит рядом, в
            месте контролов, и повторять его поверх плиты значит сказать
            гостю одно и то же дважды разными шрифтами.
          */}
          <Typography variant="body2" sx={{ color: (theme) => theme.palette.common.white }}>
            {t('guest.roomControl.offline')}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
}

/* ── Окно: рама клипует всё ───────────────────────────────────────────────── */

/**
 * Карниз и полотна физически НЕ выходят за раму — `overflow: hidden` на самом
 * окне. Свет наоборот живёт СНАРУЖИ рамы и разливается только внутрь комнаты:
 * это два разных элемента, и путать их нельзя, иначе полотна ползут по стене.
 */
function PlanWindow({
  window,
  curtain,
  blackout,
  calm,
}: {
  window: RoomPlanWindow;
  curtain: boolean | null;
  blackout?: boolean | null;
  calm: boolean;
}) {
  const { roomPlan: tokens } = useStorefront();
  const vertical = window.orientation === 'vertical';
  const open = curtain === true;
  const blackoutOpen = blackout === true;
  const daylight = open && blackout !== false;

  const gathered = vertical ? 'scaleY(.22)' : 'scaleX(.22)';
  const blackoutGathered = vertical ? 'scaleY(.06)' : 'scaleX(.06)';
  const closed = 'none';

  /**
   * Положение полотна — ИНЛАЙНОВЫМ стилем, как и вся геометрия плиты: в RTL
   * emotion развернул бы `left`/`right` и `transform-origin`, и карниз
   * вертикального окна переехал бы со стены на стену.
   */
  const panel = (side: 'start' | 'end', share: string): CSSProperties => ({
    position: 'absolute',
    ...(vertical
      ? {
          left: 0,
          right: 0,
          height: share,
          ...(side === 'start'
            ? { top: 0, transformOrigin: 'center top' }
            : { bottom: 0, transformOrigin: 'center bottom' }),
        }
      : {
          top: 0,
          bottom: 0,
          width: share,
          ...(side === 'start'
            ? { left: 0, transformOrigin: 'left center' }
            : { right: 0, transformOrigin: 'right center' }),
        }),
  });

  return (
    <>
      {daylight ? (
        <Box
          aria-hidden
          data-testid={`room-plan-daylight-${window.code}`}
          style={
            vertical
              ? {
                  left: `${window.x + window.w}%`,
                  top: `${window.y - SPILL.along - 1}%`,
                  width: `${window.w * SPILL.sideDepth}%`,
                  height: `${window.h + (SPILL.along + 1) * 2}%`,
                }
              : {
                  left: `${window.x - SPILL.along}%`,
                  top: `${window.y + window.h}%`,
                  width: `${window.w + SPILL.along * 2}%`,
                  height: `${window.h * SPILL.depth}%`,
                }
          }
          sx={{
            position: 'absolute',
            pointerEvents: 'none',
            mixBlendMode: 'screen',
            background: vertical ? tokens.daylightVertical : tokens.daylight,
            transition: calm ? 'none' : 'opacity 1s ease .3s',
          }}
        />
      ) : null}

      <Box
        aria-hidden
        data-testid={`room-plan-window-${window.code}`}
        data-open={curtain === null ? 'unknown' : String(open)}
        style={pct(window)}
        sx={{ position: 'absolute', overflow: 'hidden', pointerEvents: 'none' }}
      >
        {curtain === null ? (
          // Состояние привода не читается: полотен нет вовсе. И «открыта», и
          // «закрыта» здесь были бы придуманы.
          <Box sx={{ position: 'absolute', inset: 0, background: tokens.unknown }} />
        ) : (
          <>
            {(['start', 'end'] as const).map((side) => (
              <Box
                key={`curtain-${side}`}
                style={{ ...panel(side, '52%'), transform: open ? gathered : closed }}
                sx={{
                  background: vertical ? tokens.curtainVertical : tokens.curtain,
                  transition: calm ? 'none' : 'transform 1.2s cubic-bezier(.45,.05,.2,1)',
                }}
              />
            ))}
            {blackout === undefined || blackout === null
              ? null
              : (['start', 'end'] as const).map((side) => (
                  <Box
                    key={`blackout-${side}`}
                    data-testid={`room-plan-blackout-${window.code}-${side}`}
                    style={{
                      ...panel(side, '54%'),
                      transform: blackoutOpen ? blackoutGathered : closed,
                    }}
                    sx={{
                      background: tokens.blackout,
                      transition: calm ? 'none' : 'transform 1.1s cubic-bezier(.45,.05,.2,1)',
                    }}
                  />
                ))}
          </>
        )}
        <Box
          style={
            vertical
              ? { position: 'absolute', left: 0, top: 0, bottom: 0, width: '12%' }
              : { position: 'absolute', left: 0, right: 0, top: 0, height: '10%' }
          }
          sx={{ background: vertical ? tokens.railVertical : tokens.rail }}
        />
      </Box>
    </>
  );
}

/* ── Поток воздуха ────────────────────────────────────────────────────────── */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  span: number;
}

/**
 * Поток из точки фанкойла. Густота = скорость вентилятора; кондиционер
 * выключен — потока НЕТ, и канвас при этом не крутится вовсе: анимация,
 * которая рисует пустоту, всё равно будит телефон каждый кадр.
 *
 * В фоновой вкладке цикл тоже стоит, а `prefers-reduced-motion` отключает
 * движение полностью — поток остаётся, но одним статичным кадром, потому что
 * он показывает состояние, а не украшает.
 */
function Airflow({
  points,
  readings,
  tint,
  calm,
}: {
  points: RoomPlanPoint[];
  readings: Record<string, PlanReading>;
  tint: string;
  calm: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const sources = useMemo(
    () =>
      points
        .map((point) => {
          const reading = readings[point.controlId];
          if (!reading || reading.on !== true) return null;
          // `0` у вентилятора — АВТО, а не «выключено»: поток есть, просто
          // самый слабый. Выключение фанкойла — это toggle.
          const level = reading.fan && reading.fan > 0 ? reading.fan : 1;
          return { x: point.x, y: point.y, level: Math.min(level, AIRFLOW_DENSITY.length - 1) };
        })
        .filter(Boolean) as { x: number; y: number; level: number }[],
    [points, readings],
  );

  // Цикл перезапускается по СОДЕРЖИМОМУ источников, а не по ссылке: снимок
  // приезжает раз в минуту и по каждому событию, и на каждой новой ссылке
  // поток начинался бы с нуля — воздух дёргался бы в такт опросу.
  const signature = sources.map((s) => `${s.x}:${s.y}:${s.level}`).join('|');
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const fit = () => {
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      if (width !== canvas.width || height !== canvas.height) {
        canvas.width = width;
        canvas.height = height;
      }
      return { width, height };
    };

    const sources = sourcesRef.current;
    const { width, height } = fit();
    context.clearRect(0, 0, canvas.width, canvas.height);
    // Кондиционер выключен — потока нет и КАНВАС НЕ КРУТИТСЯ: цикл, рисующий
    // пустоту, всё равно будит телефон каждый кадр.
    if (!sources.length || !width || !height) return;

    const particles: Particle[] = [];
    const spawn = (source: { x: number; y: number; level: number }, aged: boolean) => ({
      x: (width * source.x) / 100 + (Math.random() - 0.5) * width * 0.07,
      y: (height * source.y) / 100,
      vx: (Math.random() - 0.5) * 0.5,
      vy: 0.5 + Math.random() * 0.6 * source.level,
      life: aged ? Math.random() * 80 : 0,
      span: 85 + Math.random() * 55,
    });

    const draw = () => {
      const size = fit();
      context.clearRect(0, 0, canvas.width, canvas.height);
      for (const particle of particles) {
        const age = particle.life / particle.span;
        const alpha = Math.max(0, 1 - age) * 0.28;
        const radius = 2 + age * 12;
        const gradient = context.createRadialGradient(
          particle.x,
          particle.y,
          0,
          particle.x,
          particle.y,
          radius,
        );
        gradient.addColorStop(0, `rgba(${tint},${alpha})`);
        gradient.addColorStop(1, `rgba(${tint},0)`);
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        context.fill();
      }
      return size;
    };

    if (calm) {
      // Один статичный кадр: густота читается, движения нет.
      for (const source of sources) {
        for (let i = 0; i < AIRFLOW_DENSITY[source.level]; i += 1) {
          const particle = spawn(source, true);
          particle.y += particle.vy * particle.life;
          particles.push(particle);
        }
      }
      draw();
      return;
    }

    let frame = 0;
    const tick = () => {
      // Фоновая вкладка: кадр не рисуем. Браузер и сам душит rAF, но частицы
      // при возврате иначе прыгают на сотню кадров вперёд.
      if (!document.hidden) {
        const size = fit();
        const target = sources.reduce((sum, source) => sum + AIRFLOW_DENSITY[source.level], 0);
        while (particles.length < target) {
          particles.push(spawn(sources[particles.length % sources.length], false));
        }
        for (let index = particles.length - 1; index >= 0; index -= 1) {
          const particle = particles[index];
          particle.x += particle.vx;
          particle.y += particle.vy;
          particle.life += 1;
          if (particle.life > particle.span || particle.y > size.height * 0.55) {
            particles.splice(index, 1);
          }
        }
        draw();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [signature, tint, calm]);

  return (
    <Box
      component="canvas"
      ref={canvasRef}
      aria-hidden
      data-testid="room-plan-airflow"
      data-flow={sources.length ? String(Math.max(...sources.map((s) => s.level))) : '0'}
      sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}
