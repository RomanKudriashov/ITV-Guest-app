import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTranslation } from 'react-i18next';

import { IconAirConditioner, IconLightGroup } from '@/icons';
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
const AIRFLOW_DENSITY = [0, 26, 40, 56] as const;

/**
 * Геометрия струи, в долях от короткой стороны плиты.
 *
 * `mouth` — ширина сопла: частицы рождаются НА ОТРЕЗКЕ поперёк направления, а
 * не облаком вокруг точки. Облако читалось как шум на фотографии — с него и
 * начался вопрос «что это за частицы».
 * `reach` — докуда струя добивает; дальше частица гаснет.
 * `spread` — насколько её разносит вбок к концу пути.
 */
const JET = { mouth: 0.05, reach: 0.4, spread: 0.16 } as const;

/** Единичные векторы направлений струи. */
const JET_VECTORS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
} as const;

export interface PlanReading {
  title: string;
  /**
   * Подтверждённое состояние. `null` — НЕ ЧИТАЕТСЯ, и это не то же самое, что
   * «выключено»: показать любое из двух здесь означало бы соврать.
   */
  on: boolean | null;
  /** Скорость вентилятора для точки воздуха. */
  fan: number | null;
  /**
   * Точка этого элемента — ПОТОК ВОЗДУХА, а не лампа.
   *
   * Признак берётся из возможностей элемента (`fan_speed`), а не из значения:
   * выключенный фанкойл скорости не отдаёт, и по «скорости нет» точка воздуха
   * превратилась бы в лампочку ровно тогда, когда кондиционер выключен.
   */
  air: boolean;
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
  /**
   * Потолок ВЫСОТЫ плиты — любая CSS-длина, или ничего, если потолка нет.
   *
   * Ширину плите задаёт колонка, высоту — пропорция кадра; на почти квадратном
   * кадре высота съедает телефонный экран, и до контролов под плитой нельзя
   * дотянуться. Упёршись в потолок, плита КАДР ОБРЕЗАЕТ, а не сжимает: кадр
   * лежит отдельным слоем полной высоты, и вся геометрия остаётся в процентах
   * ОТ КАДРА. Сожми мы кадр — разметка поехала бы относительно картинки.
   *
   * Обрезается НИЗ. На плане номера окна идут по наружным стенам вверху кадра,
   * и симметричная обрезка срезала бы их вместе со шторами — то есть ровно то,
   * что плита показывает движением. Внизу же у кадра запас: тёмное поле и
   * порог входной двери.
   */
  maxHeight?: string;
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
  maxHeight,
  onToggle,
}: RoomPlanPlateProps) {
  const { t } = useTranslation();
  const { roomPlan: tokens } = useStorefront();
  const calm = useMediaQuery('(prefers-reduced-motion: reduce)');
  /*
    ОБВОДКА ЖИВЁТ РОВНО СТОЛЬКО, СКОЛЬКО ИДЁТ ВЗАИМОДЕЙСТВИЕ.

    Раньше здесь лежала «выбранная зона»: её ставили по нажатию и не снимали
    никогда — снять было некому. На мыши это скрывалось следующим наведением, а
    на телефоне рамка оставалась висеть навсегда, хотя команда давно выполнена.
    Выбора у плана нет: нажатие СРАЗУ переключает свет, и «выбранная зона» —
    состояние, которому нечего означать после того, как жест кончился.

    Теперь обводка складывается из двух живых признаков: палец (или кнопка
    мыши) сейчас на этой зоне, либо по ней летит команда. Первый снимается
    отпусканием, отменой касания и уходом за пределы зоны; второй — приходом
    любого исхода: `pending` держится только в состоянии `pending`, а
    `confirmed`, `unconfirmed`, `accepted` и `failed` его снимают.
  */
  const [pressing, setPressing] = useState<string>('');

  // Пропорция приезжает с сервером и нужна ДО загрузки кадра: без неё плита
  // схлопывается в ноль, а потом прыгает на высоту картинки — ровно в тот
  // момент, когда гость уже читает список под ней.
  if (!plan.image || !plan.aspect) return null;

  const read = (controlId: string): PlanReading | undefined =>
    neutral ? undefined : readings[controlId];

  const lit = plan.zones.filter((zone) => read(zone.controlId)?.on === true).length;
  const off = plan.zones.filter((zone) => read(zone.controlId)?.on === false).length;
  // Ни одна зона не читается — это не «пять неизвестных зон», а одно «нет
  // связи»: плита говорит это одним слоем, а не пятью заплатами.
  const allUnknown = plan.zones.length > 0 && lit === 0 && off === 0;
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
        // Потолок высоты: плита ниже кадра, кадр внутри обрезается снизу.
        // Ширина при этом не трогается — её задаёт колонка.
        maxHeight,
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
        КАДР — ОТДЕЛЬНЫЙ СЛОЙ ПОЛНОЙ ВЫСОТЫ, а плита его окно.

        Пока потолка высоты нет, слой ровно совпадает с плитой и ничего не
        меняет. Упёршись в потолок, плита становится ниже кадра и обрезает его
        нижний край — но ВСЯ ГЕОМЕТРИЯ по-прежнему считается в процентах от
        ЭТОГО слоя, то есть от кадра. Считай её плита от себя, зоны, маски,
        окна и метки поехали бы относительно картинки ровно в тот момент, когда
        обрезка включилась.

        Позиция — инлайновым стилем, как и вся геометрия плиты: emotion в RTL
        развернул бы `left` на `right`.
      */}
      <Box
        data-testid="room-plan-frame"
        style={{ position: 'absolute', left: 0, top: 0, aspectRatio: String(plan.aspect) }}
        sx={{ width: '100%' }}
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

        {/*
          Зона, состояние которой не читается, накрывается НЕЙТРАЛЬНОЙ вуалью, а
          не маской: маска означает «свет выключен», и подставить её здесь значит
          ответить на вопрос, ответа на который у нас нет.

          ЕСЛИ НЕ ЧИТАЕТСЯ НИ ОДНА — вуаль ОДНА на весь кадр, мягкая, без
          прямоугольников. Пять серых заплат поверх плана выглядели поломкой
          интерфейса, а сообщают они ровно одно и то же: связи нет. Одно
          сообщение — один слой.
        */}
        {allUnknown ? (
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background: tokens.offlineHint,
              transition: motion ?? 'opacity .4s ease',
            }}
          />
        ) : (
          plan.zones.map((zone) =>
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
          )
        )}

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
              onPointerDown={() => setPressing(zone.controlId)}
              onPointerUp={() => setPressing('')}
              onPointerCancel={() => setPressing('')}
              onPointerLeave={() => setPressing('')}
              /*
                Палец увели за пределы зоны — жест отменён.

                Отдельной проверкой, а не одним `pointerleave`: касание браузер
                захватывает на цель, и пока палец не отпущен, границу зоны он не
                считает пересечённой. Сравниваем координаты с прямоугольником
                сами — это работает и пальцем, и мышью.
              */
              onPointerMove={(event) => {
                if (pressing !== zone.controlId) return;
                const box = event.currentTarget.getBoundingClientRect();
                const inside =
                  event.clientX >= box.left &&
                  event.clientX <= box.right &&
                  event.clientY >= box.top &&
                  event.clientY <= box.bottom;
                if (!inside) setPressing('');
              }}
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
                // Обводка — ответ на «куда я нажал» и «команда ещё идёт», а не
                // состояние света: состояние говорит сам кадр.
                boxShadow:
                  pressing === zone.controlId || reading?.pending ? tokens.selectedRing : 'none',
                transition: motion ?? 'background .25s ease, box-shadow .25s ease',
                // Подсветка наведения — ТОЛЬКО там, где есть чем наводить. На
                // телефоне браузер оставляет `:hover` на последнем нажатом
                // элементе до следующего касания, и подсветка зоны залипала бы
                // ровно так же, как обводка. Список и быстрые действия закрыты
                // этим же условием — здесь оно было забыто.
                '@media (hover: hover)': {
                  '&:hover:not(:disabled)': { background: tokens.zoneHover },
                },
                '&:disabled': { cursor: 'default' },
              }}
            />
          );
        })}

        {/*
          МЕТКИ СВЕТА — ПОСЛЕДНИМ СЛОЕМ.

          Точка плана — это `controlId` и координаты в процентах; чем она
          окажется, лампой или потоком воздуха, решает ЭЛЕМЕНТ, на который она
          ссылается: у фанкойла есть возможность «скорость вентилятора», у группы
          света её нет. Разбирать `controlId` строкой фронту запрещено, а второго
          поля в геометрии заводить незачем — признак уже есть в данных.

          Слой последний, потому что метка мельче зоны и лежит внутри неё: рисуй
          мы её раньше, прямоугольник зоны перехватывал бы нажатие, и по метке
          нельзя было бы попасть вовсе.

          Состояние не читается — метки нет вовсе: гореть или не гореть, мы не
          знаем, а нарисовать «потушена» значило бы ответить за оборудование.
        */}
        {plan.points.map((point) => {
          const reading = read(point.controlId);
          if (!reading || reading.air || reading.on === null) return null;
          const on = reading.on;
          return (
            <Box
              component="button"
              type="button"
              key={`marker-${point.controlId}`}
              data-testid={`room-plan-marker-${point.controlId}`}
              data-on={String(on)}
              disabled={reading.disabled}
              aria-busy={reading.pending || undefined}
              aria-pressed={on}
              aria-label={`${reading.title}: ${
                on ? t('guest.roomControl.on') : t('guest.roomControl.off')
              }`}
              // Метка своей обводки не рисует и чужую не зажигает: раньше она
              // ставила ту же «выбранную зону», и нажатие на лампу оставляло
              // рамку висеть вокруг всей комнаты.
              // ОБЩИЙ обработчик с тумблером и зоной — не копия логики.
              onClick={() => onToggle(point.controlId, on ? 0 : 1)}
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
              sx={{
                position: 'absolute',
                width: 26,
                height: 26,
                ml: '-13px',
                mt: '-13px',
                p: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                cursor: 'pointer',
                border: `1px solid ${on ? tokens.markerOn : tokens.markerBorder}`,
                background: on ? tokens.markerOnFill : tokens.markerOffFill,
                color: on ? tokens.markerOn : tokens.markerOff,
                boxShadow: on ? tokens.markerOnGlow : 'none',
                // Свет не щёлкает: метка разгорается и гаснет тем же временем,
                // что и окно зоны на кадре.
                transition: motion ?? `background ${ZONE_FADE_MS}ms ease, box-shadow ${ZONE_FADE_MS}ms ease, color ${ZONE_FADE_MS}ms ease`,
                '&:disabled': { cursor: 'default', opacity: 0.5 },
              }}
            >
              <IconLightGroup size={14} />
            </Box>
          );
        })}

        {/*
          МЕТКА ФАНКОЙЛА — ИСТОЧНИК СТРУИ.

          Без неё поток начинался ниоткуда и читался как артефакт рендера: с
          этого вопроса — «что это за частицы» — правка и началась. Метка стоит в
          ТОЙ ЖЕ точке разметки, из которой бьёт струя, поэтому источник у неё
          всегда один и разъехаться они не могут.

          Она НЕ кнопка, в отличие от меток света. Нажатие на фанкойл — это не
          «включить/выключить» одним касанием: у него скорость, уставка и режим,
          и все они живут на вкладке климата. Кружок, который выглядит как
          выключатель, но им не является, хуже отсутствия кружка.
        */}
        {plan.points.map((point) => {
          const reading = read(point.controlId);
          if (!reading || !reading.air || reading.on === null) return null;
          const on = reading.on;
          return (
            <Box
              key={`air-${point.controlId}`}
              data-testid={`room-plan-air-${point.controlId}`}
              data-on={String(on)}
              aria-hidden
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
              sx={{
                position: 'absolute',
                width: 24,
                height: 24,
                ml: '-12px',
                mt: '-12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                pointerEvents: 'none',
                border: `1px solid ${on ? tokens.markerOn : tokens.markerBorder}`,
                background: on ? tokens.markerOnFill : tokens.markerOffFill,
                color: on ? tokens.markerOn : tokens.markerOff,
                boxShadow: on ? tokens.markerOnGlow : 'none',
                transition: motion ?? `background ${ZONE_FADE_MS}ms ease, box-shadow ${ZONE_FADE_MS}ms ease, color ${ZONE_FADE_MS}ms ease`,
              }}
            >
              <IconAirConditioner size={13} />
            </Box>
          );
        })}
      </Box>


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
  /** Пройденный путь: им гасим струю, а не координатой — сторона у неё своя. */
  travel: number;
}

interface AirflowSource {
  x: number;
  y: number;
  dir: 'up' | 'down' | 'left' | 'right';
  level: number;
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
          /*
            ТОЛЬКО ТОЧКА ВОЗДУХА, И ЭТО НЕ ПРИДИРКА.

            Проверки `air` здесь не было, а точки плана — это И фанкойл, И
            метки света: формат у них один. Поэтому источником становилась
            ЛЮБАЯ включённая лампа, и при зажжённом свете струи били из
            гостиной, гардеробной, прихожей и ванной разом — «дует отовсюду».
            Признак берётся оттуда же, откуда его берут сами метки (`fan_speed`
            в возможностях элемента), иначе два места разошлись бы снова.
          */
          if (!reading || !reading.air || reading.on !== true) return null;
          // `0` у вентилятора — АВТО, а не «выключено»: поток есть, просто
          // самый слабый. Выключение фанкойла — это toggle.
          const level = reading.fan && reading.fan > 0 ? reading.fan : 1;
          return {
            x: point.x,
            y: point.y,
            dir: point.dir ?? 'down',
            level: Math.min(level, AIRFLOW_DENSITY.length - 1),
          };
        })
        .filter(Boolean) as AirflowSource[],
    [points, readings],
  );

  // Цикл перезапускается по СОДЕРЖИМОМУ источников, а не по ссылке: снимок
  // приезжает раз в минуту и по каждому событию, и на каждой новой ссылке
  // поток начинался бы с нуля — воздух дёргался бы в такт опросу.
  const signature = sources.map((s) => `${s.x}:${s.y}:${s.dir}:${s.level}`).join('|');
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

    // Короткая сторона — общая мера для геометрии струи: иначе на широком
    // экране струя вытягивается, а на узком скукоживается, хотя комната та же.
    const unit = Math.min(width, height);
    const reach = unit * JET.reach;

    const particles: Particle[] = [];

    /**
     * Частица рождается НА СОПЛЕ — отрезке поперёк направления, — и летит
     * вдоль него. Никакого облака вокруг точки: один читаемый поток от
     * источника, а не рассеянная взвесь по всей комнате.
     */
    const spawn = (source: AirflowSource, aged: boolean): Particle => {
      const vector = JET_VECTORS[source.dir] ?? JET_VECTORS.down;
      // Поперечная ось: та же пара координат, повёрнутая на четверть оборота.
      const across = { x: -vector.y, y: vector.x };
      const offset = (Math.random() - 0.5) * unit * JET.mouth;
      const speed = 0.55 + 0.28 * source.level + Math.random() * 0.3;
      // Разлёт вбок — доля продольной скорости, поэтому струя расширяется
      // конусом, а не рвётся на отдельные ниточки.
      const drift = (Math.random() - 0.5) * speed * JET.spread;
      return {
        x: (width * source.x) / 100 + across.x * offset,
        y: (height * source.y) / 100 + across.y * offset,
        vx: vector.x * speed + across.x * drift,
        vy: vector.y * speed + across.y * drift,
        life: aged ? Math.random() * 110 : 0,
        span: 150 + Math.random() * 70,
        // Путь считаем сами: гасить по координате нельзя — у каждой стороны
        // она своя, и правило «ниже середины» работало только вниз.
        travel: 0,
      };
    };

    const draw = () => {
      const size = fit();
      context.clearRect(0, 0, canvas.width, canvas.height);
      for (const particle of particles) {
        const age = particle.life / particle.span;
        /*
          ПЛОТНО У СОПЛА, ТАЕТ К КОНЦУ — так читается направление.

          Наоборот (прозрачно у источника, крупные пятна в хвосте) струя
          собиралась комком на отлёте и выглядела висящей в воздухе кляксой,
          оторванной от фанкойла. Короткий разгон в первые кадры оставлен,
          чтобы частица не возникала из ничего ровно на метке.
        */
        const fade = Math.min(1, age * 40) * (1 - age) ** 1.4;
        const alpha = Math.max(0, fade) * 0.9;
        const radius = unit * 0.011 + age * unit * 0.026;
        const gradient = context.createRadialGradient(
          particle.x,
          particle.y,
          0,
          particle.x,
          particle.y,
          radius,
        );
        gradient.addColorStop(0, `rgba(${tint},${alpha})`);
        gradient.addColorStop(0.55, `rgba(${tint},${alpha * 0.45})`);
        gradient.addColorStop(1, `rgba(${tint},0)`);
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        context.fill();
      }
      return size;
    };

    const step = (particle: Particle) => {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.life += 1;
      particle.travel += Math.hypot(particle.vx, particle.vy);
    };

    if (calm) {
      // Один статичный кадр: густота и направление читаются, движения нет.
      for (const source of sources) {
        for (let i = 0; i < AIRFLOW_DENSITY[source.level]; i += 1) {
          const particle = spawn(source, true);
          const steps = particle.life;
          particle.life = 0;
          for (let s = 0; s < steps; s += 1) step(particle);
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
        fit();
        const target = sources.reduce((sum, source) => sum + AIRFLOW_DENSITY[source.level], 0);
        while (particles.length < target) {
          /*
            Досев — С РАЗБРОСОМ ПО ВОЗРАСТУ, и это не украшение.

            Пачка, рождённая одним кадром в одной точке, летит СГУСТКОМ:
            появляется у сопла, уезжает целиком и разом гаснет. На экране это
            читалось как два-три пятна, а не как струя, — ровно то, что и
            назвали «частицами непонятно чего». Разбросав возраст, получаем
            заполненный по всей длине поток, который дальше сам себя
            поддерживает: сроки жизни у частиц разные, и гаснут они вразнобой.
          */
          const particle = spawn(sources[particles.length % sources.length], true);
          const steps = particle.life;
          particle.life = 0;
          for (let s = 0; s < steps; s += 1) step(particle);
          particles.push(particle);
        }
        for (let index = particles.length - 1; index >= 0; index -= 1) {
          const particle = particles[index];
          step(particle);
          if (particle.life > particle.span || particle.travel > reach) {
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
