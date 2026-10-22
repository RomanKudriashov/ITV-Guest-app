import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popper from '@mui/material/Popper';
import { useTranslation } from 'react-i18next';

import { accent, ink, shadow, shape, state, surface, typo } from '../../adminTokens';
import type { MapBuilding, MapRoom, RoomProblem } from '../../adminClient';

/**
 * СХЕМА НОМЕРНОГО ФОНДА (партия 63-1): раскраска слоями, легенда, схема
 * корпуса «этажи × позиции», блоки и карточка номера у курсора.
 *
 * Цвет — не единственный признак: у каждого значения свой знак (✓ ! ✕ –),
 * у «плохих» значений — штриховка. Человек, не различающий красный и
 * зелёный, читает схему по знакам.
 */

export type Layer = 'control' | 'variant' | 'pin' | 'problems';
export const LAYERS: Layer[] = ['control', 'variant', 'pin', 'problems'];
export const PROBLEM_ORDER: RoomProblem[] = ['no_link', 'no_variant', 'not_published', 'no_pin', 'demo_entry'];

export interface Swatch {
  value: string;
  label: string;
  base: string;
  glyph: string;
  hatch: boolean;
}

const mix = (a: string, b: string, pa: number) => `color-mix(in srgb, ${a} ${pa}%, ${b})`;
const MUTED = ink.low;
/*
  Оттенки вариантов — из словаря смешением (`check-colors`): своих цветов у
  экрана нет. Красного и жёлтого «бед» среди них нет — вариант не беда.
*/
const VARIANT_HUES = [
  accent.main,
  state.info,
  state.gold,
  state.ok,
  mix(state.info, state.ok, 50),
  mix(state.gold, accent.main, 50),
  mix(state.ok, state.gold, 50),
  mix(state.info, accent.main, 50),
];
const VARIANT_GLYPHS = '123456789АБВГДЕЖИКЛМН';

/** Значение номера в слое: подпись, цвет, знак. Порядок легенды — порядок `swatches`. */
export function useSwatches(rooms: MapRoom[]) {
  const { t } = useTranslation();
  const variants = useMemo(() => {
    const seen = new Map<string, string>();
    for (const room of rooms) if (room.variant && !seen.has(room.variant.code)) seen.set(room.variant.code, room.variant.title);
    return [...seen.entries()].sort(([, a], [, b]) => a.localeCompare(b, 'ru', { numeric: true }));
  }, [rooms]);

  return useMemo(() => {
    const off: Swatch = { value: 'off', label: t('admin.card.rooms.control.off'), base: MUTED, glyph: '–', hatch: false };
    const lists: Record<Layer, Swatch[]> = {
      control: [
        { value: 'ok', label: t('admin.card.rooms.control.ok'), base: state.ok, glyph: '✓', hatch: false },
        { value: 'attention', label: t('admin.card.rooms.control.attention'), base: state.warn, glyph: '!', hatch: false },
        { value: 'blocked', label: t('admin.card.rooms.control.blocked'), base: state.bad, glyph: '✕', hatch: true },
        off,
      ],
      variant: [
        ...variants.map(([code, title], i) => ({ value: `v:${code}`, label: title, base: VARIANT_HUES[i % VARIANT_HUES.length], glyph: VARIANT_GLYPHS[i] ?? '•', hatch: false })),
        { value: 'v:', label: t('admin.card.rooms.noVariantValue'), base: MUTED, glyph: '–', hatch: true },
      ],
      pin: [
        { value: 'yes', label: t('admin.card.rooms.pinValue.yes'), base: state.ok, glyph: '✓', hatch: false },
        { value: 'no', label: t('admin.card.rooms.pinValue.no'), base: state.bad, glyph: '✕', hatch: true },
      ],
      problems: [
        { value: 'none', label: t('admin.card.rooms.problem.none'), base: state.ok, glyph: '✓', hatch: false },
        { value: 'no_link', label: t('admin.card.rooms.problem.no_link'), base: state.bad, glyph: '∅', hatch: true },
        { value: 'no_variant', label: t('admin.card.rooms.problem.no_variant'), base: state.bad, glyph: '?', hatch: true },
        { value: 'not_published', label: t('admin.card.rooms.problem.not_published'), base: state.warn, glyph: '…', hatch: true },
        { value: 'no_pin', label: t('admin.card.rooms.problem.no_pin'), base: state.bad, glyph: '#', hatch: false },
        { value: 'demo_entry', label: t('admin.card.rooms.problem.demo_entry'), base: state.warn, glyph: '!', hatch: false },
        off,
      ],
    };
    const valueOf = (room: MapRoom, layer: Layer): string => {
      switch (layer) {
        case 'control':
          return room.control;
        case 'variant':
          return `v:${room.variant?.code ?? ''}`;
        case 'pin':
          return room.pin ? 'yes' : 'no';
        case 'problems':
          if (room.control === 'off') return 'off';
          return PROBLEM_ORDER.find((code) => room.problems.includes(code)) ?? 'none';
      }
    };
    const swatchOf = (room: MapRoom, layer: Layer): Swatch => {
      const value = valueOf(room, layer);
      return lists[layer].find((s) => s.value === value) ?? off;
    };
    return { lists, valueOf, swatchOf };
  }, [t, variants]);
}

export type Swatches = ReturnType<typeof useSwatches>;

/** Заливка клетки: размытый цвет значения, у «плохих» — штриховка. */
export function cellPaint(s: Swatch) {
  return {
    bgcolor: mix(s.base, surface.s1, 26),
    backgroundImage: s.hatch ? `repeating-linear-gradient(135deg, transparent 0 4px, ${mix(s.base, surface.s1, 42)} 4px 6px)` : 'none',
    borderColor: mix(s.base, surface.s1, 70),
  };
}

function SwatchMark({ s, size = 16 }: { s: Swatch; size?: number }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        ...cellPaint(s),
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '4px',
        border: '1px solid',
        display: 'inline-grid',
        placeItems: 'center',
        fontSize: size * 0.62,
        fontWeight: 800,
        lineHeight: 1,
        color: ink.hi,
      }}
    >
      {s.glyph}
    </Box>
  );
}

/**
 * ЛЕГЕНДА СЛОВАМИ СО СЧЁТЧИКАМИ. Наведение (или фокус, или касание) на
 * строку подсвечивает её номера на схеме — остальные гаснут.
 */
export function Legend({
  rooms,
  layer,
  swatches,
  highlight,
  onHighlight,
}: {
  rooms: MapRoom[];
  layer: Layer;
  swatches: Swatches;
  highlight: string | null;
  onHighlight: (value: string | null) => void;
}) {
  const counts = new Map<string, number>();
  for (const room of rooms) {
    const value = swatches.valueOf(room, layer);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const shown = swatches.lists[layer].filter((s) => counts.get(s.value));
  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }} data-testid="admin-rooms-legend" onMouseLeave={() => onHighlight(null)}>
      {shown.map((s) => (
        <ButtonBase
          key={s.value}
          data-testid={`admin-rooms-legend-${s.value}`}
          aria-pressed={highlight === s.value}
          onMouseEnter={() => onHighlight(s.value)}
          onFocus={() => onHighlight(s.value)}
          onBlur={() => onHighlight(null)}
          onClick={() => onHighlight(highlight === s.value ? null : s.value)}
          sx={{
            gap: 0.75,
            px: 1,
            py: 0.5,
            borderRadius: `${shape.radiusSmall}px`,
            ...typo.caption,
            color: ink.hi,
            border: `1px solid ${highlight === s.value ? accent.main : 'transparent'}`,
            bgcolor: highlight === s.value ? accent.washSoft : 'transparent',
            '&:hover': { bgcolor: surface.s2 },
          }}
        >
          <SwatchMark s={s} />
          <span>
            {s.label} <Box component="span" sx={{ fontWeight: 800 }}>— {counts.get(s.value)}</Box>
          </span>
        </ButtonBase>
      ))}
    </Box>
  );
}

/** Подсветка по легенде: одно правило на контейнер, а не по правилу на клетку. */
export function highlightSx(highlight: string | null) {
  if (!highlight) return {};
  return {
    '& [data-v]': { opacity: 0.16 },
    [`& [data-v="${CSS.escape(highlight)}"]`]: { opacity: 1, outline: `2px solid ${accent.main}`, outlineOffset: '1px' },
  };
}

/* ── Схема корпуса: этажи × позиции ─────────────────────────────────────── */

/** Ширина элемента — живьём, чтобы схема вписывалась при любом окне. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Шаги масштаба: 0 — «весь корпус» (вписать), дальше — ширина клетки в точках. */
export const ZOOM_STEPS = [0, 28, 40, 56, 72];
const MAX_FIT = 96;

export function BuildingScheme({
  building,
  layer,
  swatches,
  zoom,
  narrow,
}: {
  building: MapBuilding;
  layer: Layer;
  swatches: Swatches;
  zoom: number;
  narrow: boolean;
}) {
  const { t } = useTranslation();
  const [ref, width] = useWidth<HTMLDivElement>();
  const positions = useMemo(() => {
    const list = [...building.positions];
    if (building.floors.some((f) => f.rooms.some((r) => !r.position))) list.push('');
    return list;
  }, [building]);
  const columns = Math.max(positions.length, 1);
  const label = narrow ? 30 : 52;
  const gap = columns > 40 ? 1 : columns > 16 ? 2 : 3;
  // «Вписать» — не шире 96 точек: у отеля на три номера в ряд клетки иначе растягивались на весь экран.
  const fit = Math.min(Math.max((width - label - gap * columns) / columns, 1), MAX_FIT);
  const cell = zoom > 0 ? Math.max(ZOOM_STEPS[zoom] ?? fit, fit) : fit;
  const height = Math.round(Math.min(Math.max(cell * 0.72, 12), 40));
  const showNumber = cell >= 38;
  const showGlyph = cell >= 11;
  // Подписи позиций — не теснее 22 точек: при узких клетках — каждая k-я.
  const every = Math.max(1, Math.ceil(22 / Math.max(cell + gap, 1)));
  const template = zoom > 0 ? `${label}px repeat(${columns}, ${cell}px)` : `${label}px repeat(${columns}, minmax(0, ${MAX_FIT}px))`;
  const at = (floorRooms: MapRoom[], position: string) => floorRooms.filter((r) => r.position === position);

  return (
    // Справа — запас под подпись последней позиции: над узкой колонкой она шире
    // колонки и иначе выступала за край на пару точек (e2e 63-1, 390).
    <Box ref={ref} sx={{ overflowX: zoom > 0 ? 'auto' : 'hidden', pb: zoom > 0 ? 1 : 0, pr: zoom > 0 ? 0 : 1 }} data-testid={`admin-rooms-scheme-${building.key || 'none'}`}>
      <Box sx={{ display: 'grid', gridTemplateColumns: template, columnGap: `${gap}px`, rowGap: `${Math.max(gap, 2)}px`, alignItems: 'center', minWidth: 0 }}>
        <Box />
        {positions.map((p, i) => (
          <Box key={`h-${p}`} sx={{ ...typo.caption, fontSize: 10.5, color: ink.low, display: 'flex', justifyContent: 'center', whiteSpace: 'nowrap', overflow: 'visible', minWidth: 0, width: '100%' }}>
            {i % every === 0 ? (p ? p : '—') : ''}
          </Box>
        ))}
        {building.floors.map((floor) => (
          <FloorRow key={`f-${floor.floor}`} floor={floor.floor} narrow={narrow} t={t}>
            {positions.map((p) => {
              const here = at(floor.rooms, p);
              return (
                <Box key={`c-${floor.floor}-${p}`} sx={{ display: 'flex', gap: '1px', minWidth: 0, height }}>
                  {here.map((room) => (
                    <RoomCell key={room.id} room={room} layer={layer} swatches={swatches} showNumber={showNumber && here.length === 1} showGlyph={showGlyph} />
                  ))}
                </Box>
              );
            })}
          </FloorRow>
        ))}
      </Box>
    </Box>
  );
}

function FloorRow({ floor, narrow, t, children }: { floor: string; narrow: boolean; t: (key: string, o?: Record<string, unknown>) => string; children: ReactNode }) {
  return (
    <>
      <Box sx={{ ...typo.caption, fontWeight: 700, color: ink.mid, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pr: 0.5 }}>
        {floor ? (narrow ? floor : t('admin.card.rooms.floorShort', { floor })) : '—'}
      </Box>
      {children}
    </>
  );
}

export function RoomCell({
  room,
  layer,
  swatches,
  showNumber,
  showGlyph,
  sx,
}: {
  room: MapRoom;
  layer: Layer;
  swatches: Swatches;
  showNumber: boolean;
  showGlyph: boolean;
  sx?: object;
}) {
  const s = swatches.swatchOf(room, layer);
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={`${room.number}: ${s.label}`}
      data-testid={`admin-room-${room.number}`}
      data-room-id={room.id}
      data-v={s.value}
      sx={{
        ...cellPaint(s),
        position: 'relative',
        flex: '1 1 0',
        minWidth: 0,
        height: '100%',
        borderRadius: '4px',
        border: '1px solid',
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
        overflow: 'hidden',
        opacity: room.is_active ? 1 : 0.55,
        color: ink.hi,
        transition: 'opacity .12s',
        '&:focus-visible': { outline: `2px solid ${accent.main}`, outlineOffset: '1px' },
        ...sx,
      }}
    >
      {showNumber ? (
        <Box component="span" sx={{ fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap', px: '2px' }}>
          {room.number}
        </Box>
      ) : showGlyph ? (
        <Box component="span" sx={{ fontSize: 10, fontWeight: 800, lineHeight: 1 }}>{s.glyph}</Box>
      ) : null}
      {showNumber ? (
        <Box component="span" aria-hidden sx={{ position: 'absolute', top: 1, right: 3, fontSize: 9, fontWeight: 800, lineHeight: 1 }}>
          {s.glyph}
        </Box>
      ) : null}
    </Box>
  );
}

/* ── Блоки: номера плитками по этажам ───────────────────────────────────── */

export function BuildingBlocks({ building, layer, swatches }: { building: MapBuilding; layer: Layer; swatches: Swatches }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'grid', gap: 1.25 }} data-testid={`admin-rooms-blocks-${building.key || 'none'}`}>
      {building.floors.map((floor) => (
        <Box key={floor.floor}>
          <Box sx={{ ...typo.label, color: ink.mid, mb: 0.5 }}>{floor.floor ? t('admin.card.rooms.floorLong', { floor: floor.floor }) : t('admin.card.rooms.noFloor')}</Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(58px, 1fr))', gap: 0.75 }}>
            {floor.rooms.map((room) => (
              <Box key={room.id} sx={{ height: 40, display: 'flex' }}>
                <RoomCell room={room} layer={layer} swatches={swatches} showNumber showGlyph />
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/* ── Карточка номера у курсора ──────────────────────────────────────────── */

/**
 * ПОЧЕМУ НЕ `Tooltip`. В песочнице 63-М подсказка садилась в левый верхний
 * угол: она была привязана к обёртке `display: contents` — у такого элемента
 * нет рамки, `getBoundingClientRect()` даёт нули, и Popper ставит карточку в
 * (0, 0). Здесь одна карточка на всю схему, привязанная к точке курсора
 * (виртуальный якорь), с переворотом и удержанием в окне.
 */
export function useCursorCard(rooms: Map<string, MapRoom>, enabled: boolean) {
  const [hover, setHover] = useState<{ room: MapRoom; x: number; y: number } | null>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const handlers = enabled
    ? {
        onMouseMove: (event: React.MouseEvent) => {
          const target = (event.target as HTMLElement).closest('[data-room-id]') as HTMLElement | null;
          const room = target ? rooms.get(target.dataset.roomId ?? '') : undefined;
          const { clientX: x, clientY: y } = event;
          cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => setHover(room ? { room, x, y } : null));
        },
        onMouseLeave: () => {
          cancelAnimationFrame(frame.current);
          setHover(null);
        },
      }
    : {};
  return { hover, handlers };
}

export function CursorCard({ hover, children }: { hover: { x: number; y: number } | null; children: ReactNode }) {
  const anchor = useMemo(
    () =>
      hover
        ? {
            getBoundingClientRect: () => DOMRect.fromRect({ x: hover.x, y: hover.y, width: 0, height: 0 }),
          }
        : null,
    [hover],
  );
  return (
    <Popper
      open={Boolean(anchor)}
      anchorEl={anchor}
      placement="bottom-start"
      sx={{ zIndex: 1500, pointerEvents: 'none' }}
      modifiers={[
        { name: 'offset', options: { offset: [14, 14] } },
        { name: 'flip', options: { fallbackPlacements: ['top-start', 'bottom-end', 'top-end'], padding: 8 } },
        { name: 'preventOverflow', options: { padding: 8, altAxis: true } },
      ]}
    >
      <Box
        data-testid="admin-room-card"
        sx={{
          ...typo.caption,
          minWidth: 230,
          maxWidth: 300,
          p: 1.5,
          borderRadius: `${shape.radius}px`,
          bgcolor: surface.s1,
          color: ink.hi,
          border: `1px solid ${surface.line}`,
          boxShadow: shadow.menu,
        }}
      >
        {children}
      </Box>
    </Popper>
  );
}
