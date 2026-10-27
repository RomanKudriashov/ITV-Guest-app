import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popper from '@mui/material/Popper';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddIcon from '@mui/icons-material/Add';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import KeyOffOutlinedIcon from '@mui/icons-material/KeyOffOutlined';
import WifiOutlinedIcon from '@mui/icons-material/WifiOutlined';
import WifiOffOutlinedIcon from '@mui/icons-material/WifiOffOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import LayersClearOutlinedIcon from '@mui/icons-material/LayersClearOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import BlockIcon from '@mui/icons-material/Block';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import { useTranslation } from 'react-i18next';

import { accent, ink, shadow, shape, state, surface, typo } from '../../adminTokens';
import type { MapBuilding, MapRoom, RoomProblem } from '../../adminClient';

/**
 * СХЕМА НОМЕРНОГО ФОНДА (партия 63-1): раскраска слоями, легенда, плитка
 * номера трёх видов на выбор и карточка номера у курсора.
 *
 * Плитка (выбор Олега — все три с переключателем):
 *   a «Полоса»   — крупный номер, цвет слоя узкой полосой слева, значки
 *                  вариант / PIN / связь (зачёркнутый — нет);
 *   b «Карточка» — тень, значок состояния в углу, категория и слово;
 *   c «Шахматка» — плотная таблица, номер и короткое слово в клетке.
 *
 * Цвет — не единственный признак: у значения есть знак и слово. Большой
 * корпус не листается вбок — ряд позиций режется на части по ширине экрана,
 * стояки внутри части по-прежнему друг под другом.
 */

export type Layer = 'control' | 'variant' | 'connection' | 'pin' | 'problems';
export const LAYERS: Layer[] = ['control', 'variant', 'connection', 'pin', 'problems'];
export const PROBLEM_ORDER: RoomProblem[] = ['no_link', 'no_variant', 'not_published', 'no_pin', 'demo_entry'];
export type Tile = 'a' | 'b' | 'c';
export const TILES: Tile[] = ['a', 'b', 'c'];

type Tone = 'ok' | 'warn' | 'bad' | 'off' | 'info';

export interface Swatch {
  value: string;
  label: string;
  base: string;
  glyph: string;
  hatch: boolean;
  tone: Tone;
}

const mix = (a: string, b: string, pa: number) => `color-mix(in srgb, ${a} ${pa}%, ${b})`;
const MUTED = ink.low;
const TONE: Record<Tone, string> = { ok: state.ok, warn: state.warn, bad: state.bad, off: ink.low, info: accent.main };
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

/** Значение номера в слое: подпись, цвет, знак, тон. Порядок легенды — порядок `lists`. */
export function useSwatches(rooms: MapRoom[]) {
  const { t } = useTranslation();
  const variants = useMemo(() => {
    const seen = new Map<string, string>();
    for (const room of rooms) if (room.variant && !seen.has(room.variant.code)) seen.set(room.variant.code, room.variant.title);
    return [...seen.entries()].sort(([, a], [, b]) => a.localeCompare(b, 'ru', { numeric: true }));
  }, [rooms]);
  // Подключения номеров (партия 65): «по умолчанию» первым, остальные по имени.
  const connections = useMemo(() => {
    const seen = new Map<string, { name: string; default: boolean }>();
    for (const room of rooms) if (room.connection && !seen.has(room.connection.id)) seen.set(room.connection.id, { name: room.connection.name, default: room.connection.default });
    return [...seen.entries()].sort(([, a], [, b]) => Number(b.default) - Number(a.default) || a.name.localeCompare(b.name, 'ru', { numeric: true }));
  }, [rooms]);

  return useMemo(() => {
    const off: Swatch = { value: 'off', label: t('admin.card.rooms.control.off'), base: MUTED, glyph: '–', hatch: false, tone: 'off' };
    const lists: Record<Layer, Swatch[]> = {
      control: [
        { value: 'ok', label: t('admin.card.rooms.control.ok'), base: state.ok, glyph: '✓', hatch: false, tone: 'ok' },
        { value: 'attention', label: t('admin.card.rooms.control.attention'), base: state.warn, glyph: '!', hatch: false, tone: 'warn' },
        { value: 'blocked', label: t('admin.card.rooms.control.blocked'), base: state.bad, glyph: '✕', hatch: true, tone: 'bad' },
        off,
      ],
      variant: [
        ...variants.map(([code, title], i) => ({
          value: `v:${code}`,
          label: title,
          base: VARIANT_HUES[i % VARIANT_HUES.length],
          glyph: VARIANT_GLYPHS[i] ?? '•',
          hatch: false,
          tone: 'info' as Tone,
        })),
        { value: 'v:', label: t('admin.card.rooms.noVariantValue'), base: MUTED, glyph: '–', hatch: true, tone: 'off' },
      ],
      connection: [
        ...connections.map(([id, c], i) => ({
          value: `c:${id}`,
          label: c.default ? `${c.name} · ${t('admin.card.rooms.connectionDefaultShort')}` : c.name,
          base: VARIANT_HUES[(i + 3) % VARIANT_HUES.length],
          glyph: VARIANT_GLYPHS[i] ?? '•',
          hatch: false,
          tone: 'info' as Tone,
        })),
        { value: 'c:', label: t('admin.card.rooms.noConnection'), base: MUTED, glyph: '–', hatch: true, tone: 'off' },
      ],
      pin: [
        { value: 'yes', label: t('admin.card.rooms.pinValue.yes'), base: state.ok, glyph: '✓', hatch: false, tone: 'ok' },
        { value: 'no', label: t('admin.card.rooms.pinValue.no'), base: state.bad, glyph: '✕', hatch: true, tone: 'bad' },
      ],
      problems: [
        { value: 'none', label: t('admin.card.rooms.problem.none'), base: state.ok, glyph: '✓', hatch: false, tone: 'ok' },
        { value: 'no_link', label: t('admin.card.rooms.problem.no_link'), base: state.bad, glyph: '∅', hatch: true, tone: 'bad' },
        { value: 'no_variant', label: t('admin.card.rooms.problem.no_variant'), base: state.bad, glyph: '?', hatch: true, tone: 'bad' },
        { value: 'not_published', label: t('admin.card.rooms.problem.not_published'), base: state.warn, glyph: '…', hatch: true, tone: 'warn' },
        { value: 'no_pin', label: t('admin.card.rooms.problem.no_pin'), base: state.bad, glyph: '#', hatch: false, tone: 'bad' },
        { value: 'demo_entry', label: t('admin.card.rooms.problem.demo_entry'), base: state.warn, glyph: '!', hatch: false, tone: 'warn' },
        off,
      ],
    };
    const valueOf = (room: MapRoom, layer: Layer): string => {
      switch (layer) {
        case 'control':
          return room.control;
        case 'variant':
          return `v:${room.variant?.code ?? ''}`;
        case 'connection':
          return `c:${room.connection?.id ?? ''}`;
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
    /** Слово на плитке: коротко, что с номером в этом слое. `tiny` — для клетки шахматки. */
    const wordOf = (room: MapRoom, layer: Layer, tiny = false): string => {
      const set = tiny ? 'tiny' : 'short';
      if (layer === 'variant') return room.variant ? room.variant.title : t(`admin.card.rooms.${set}.noVariant`);
      if (layer === 'connection') return room.connection ? room.connection.name : t('admin.card.rooms.noConnection');
      if (layer === 'pin') return t(`admin.card.rooms.${set}.${room.pin ? 'pinYes' : 'no_pin'}`);
      if (room.control === 'off') return t(`admin.card.rooms.${set}.${room.is_active ? 'off' : 'inactive'}`);
      if (layer === 'control' && room.control === 'ok') return t(`admin.card.rooms.${set}.ok`);
      const first = PROBLEM_ORDER.find((code) => room.problems.includes(code));
      return first ? t(`admin.card.rooms.${set}.${first}`) : t(`admin.card.rooms.${set}.none`);
    };
    return { lists, valueOf, swatchOf, wordOf };
  }, [t, variants, connections]);
}

export type Swatches = ReturnType<typeof useSwatches>;

/** Заливка знака легенды: размытый цвет значения, у «плохих» — штриховка. */
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

/** Подсветка по легенде: одно правило на контейнер, а не по правилу на плитку. */
export function highlightSx(highlight: string | null) {
  if (!highlight) return {};
  return {
    '& [data-v]': { opacity: 0.16 },
    [`& [data-v="${CSS.escape(highlight)}"]`]: { opacity: 1, outline: `2px solid ${accent.main}`, outlineOffset: '1px' },
  };
}

/* ── Схема корпуса: этажи × позиции, ряд режется на части ───────────────── */

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

/** Масштаб плитки: шаги −1…2, 0 — обычный размер. */
export const ZOOM_MIN = -1;
export const ZOOM_MAX = 2;
const SCALE: Record<number, number> = { [-1]: 0.82, 0: 1, 1: 1.22, 2: 1.5 };

const SIZES: Record<Tile, { w: number; h: number; gap: number; wPhone: number; hPhone: number }> = {
  a: { w: 64, h: 52, gap: 6, wPhone: 56, hPhone: 48 },
  b: { w: 92, h: 66, gap: 8, wPhone: 76, hPhone: 62 },
  c: { w: 46, h: 32, gap: 0, wPhone: 42, hPhone: 30 },
};

export function BuildingScheme({
  building,
  layer,
  swatches,
  tile,
  zoom,
  onAdd,
  selected,
  onSelect,
}: {
  building: MapBuilding;
  layer: Layer;
  swatches: Swatches;
  tile: Tile;
  zoom: number;
  /** «+» в конце этажа: добавить номер на этот этаж этого корпуса; нет — нет кнопки. */
  onAdd?: (floor: string) => void;
  /** Выбранные номера (63-2) и «выбрать эти»: весь этаж, весь стояк. */
  selected?: Set<string>;
  onSelect?: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [ref, width] = useWidth<HTMLDivElement>();
  const phone = useMediaQuery('(max-width:599px)');
  const size = SIZES[tile];
  const scale = SCALE[zoom] ?? 1;
  const w = Math.round((phone ? size.wPhone : size.w) * scale);
  const h = Math.round((phone ? size.hPhone : size.h) * scale);
  const gap = size.gap;
  const label = phone ? 30 : 52;
  const plusWidth = onAdd ? Math.min(w, 32) : 0;
  const plus = onAdd ? plusWidth + Math.max(gap, 4) + (tile === 'c' ? 4 : 0) : 0;
  const positions = useMemo(() => {
    const list = [...building.positions];
    if (building.floors.some((f) => f.rooms.some((r) => !r.position))) list.push('');
    return list;
  }, [building]);
  // Сколько позиций влезает в ряд; ряд режется на равные части.
  const fit = Math.max(1, Math.floor((width - label - plus - 2 + gap) / (w + gap)));
  const parts = Math.max(1, Math.ceil(positions.length / fit));
  const per = Math.ceil(positions.length / parts);
  const chunks = Array.from({ length: parts }, (_, i) => positions.slice(i * per, (i + 1) * per)).filter((c) => c.length);

  return (
    <Box ref={ref} sx={{ display: 'grid', gap: 2, minWidth: 0, overflow: 'hidden' }} data-testid={`admin-rooms-scheme-${building.key || 'none'}`} data-tile={tile}>
      {width > 0
        ? chunks.map((chunk, i) => (
            <Box key={i} sx={{ minWidth: 0 }}>
              {chunks.length > 1 ? (
                <Box sx={{ ...typo.caption, color: ink.low, mb: 0.5 }}>
                  {t('admin.card.rooms.part', { from: chunk[0] || '—', to: chunk[chunk.length - 1] || '—' })}
                </Box>
              ) : null}
              <Part
                building={building}
                positions={chunk}
                w={w}
                h={h}
                gap={gap}
                label={label}
                phone={phone}
                tile={tile}
                layer={layer}
                swatches={swatches}
                onAdd={i === chunks.length - 1 ? onAdd : undefined}
                plusWidth={plusWidth}
                selected={selected}
                onSelect={onSelect}
              />
            </Box>
          ))
        : null}
    </Box>
  );
}

function Part({
  building,
  positions,
  w,
  h,
  gap,
  label,
  phone,
  tile,
  layer,
  swatches,
  onAdd,
  plusWidth,
  selected,
  onSelect,
}: {
  building: MapBuilding;
  positions: string[];
  w: number;
  h: number;
  gap: number;
  label: number;
  phone: boolean;
  tile: Tile;
  layer: Layer;
  swatches: Swatches;
  onAdd?: (floor: string) => void;
  plusWidth: number;
  selected?: Set<string>;
  onSelect?: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const chess = tile === 'c';
  // «Весь этаж» и «весь стояк» — по всему корпусу, а не только по этой части ряда.
  const floorIds = (floor: string) => building.floors.find((f) => f.floor === floor)?.rooms.map((r) => r.id) ?? [];
  const stackIds = (position: string) => building.floors.flatMap((f) => f.rooms.filter((r) => r.position === position).map((r) => r.id));
  const picker = (label: ReactNode, title: string, ids: () => string[], testId: string, sx: object) =>
    onSelect ? (
      <ButtonBase
        onClick={(e) => {
          e.stopPropagation();
          onSelect(ids());
        }}
        title={title}
        aria-label={title}
        data-testid={testId}
        sx={{ ...sx, justifyContent: 'center', '&:hover': { color: accent.soft, bgcolor: accent.washSoft } }}
      >
        {label}
      </ButtonBase>
    ) : (
      <Box sx={sx}>{label}</Box>
    );
  const line = `1px solid ${surface.line}`;
  const columns = `${label}px repeat(${positions.length}, ${w}px)${onAdd ? ` ${plusWidth + (chess ? 4 : 0)}px` : ''}`;
  const floorText = (floor: string) => (floor ? (phone ? floor : t('admin.card.rooms.floorShort', { floor })) : '—');
  const chessCell = (extra: object = {}) => (chess ? { borderRight: line, borderBottom: line, ...extra } : {});
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: columns,
        columnGap: `${gap}px`,
        rowGap: `${gap}px`,
        alignItems: 'stretch',
        width: 'max-content',
        maxWidth: '100%',
        ...(chess ? { borderTop: line, borderLeft: line } : {}),
      }}
    >
      <Box sx={chessCell({ bgcolor: surface.s2 })} />
      {positions.map((p) => (
        <Box key={`h-${p}`} sx={{ display: 'flex', minWidth: 0 }}>
          {picker(
            p || '—',
            t('admin.card.rooms.sel.stack', { position: p || '—' }),
            () => stackIds(p),
            `admin-rooms-select-stack-${building.key || 'none'}-${p || 'none'}`,
            {
              ...typo.caption,
              fontSize: 10.5,
              fontWeight: chess ? 700 : 400,
              color: ink.low,
              textAlign: 'center',
              whiteSpace: 'nowrap',
              lineHeight: '20px',
              borderRadius: chess ? 0 : '4px',
              flex: 1,
              ...chessCell({ bgcolor: surface.s2 }),
            },
          )}
        </Box>
      ))}
      {onAdd ? <Box sx={chess ? { borderBottom: line, ml: '-1px' } : undefined} /> : null}
      {building.floors.map((floor) => (
        <FloorRow key={`f-${floor.floor}`}>
          {picker(
            floorText(floor.floor),
            t('admin.card.rooms.sel.floor', { floor: floor.floor || '—' }),
            () => floorIds(floor.floor),
            `admin-rooms-select-floor-${building.key || 'none'}-${floor.floor || 'none'}`,
            {
              ...typo.caption,
              fontWeight: 700,
              color: ink.mid,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start !important',
              px: chess ? 0.5 : 0,
              borderRadius: chess ? 0 : '4px',
              height: '100%',
              ...chessCell({ bgcolor: surface.s2 }),
            },
          )}
          {positions.map((p) => {
            const here = floor.rooms.filter((r) => r.position === p);
            return (
              <Box key={`c-${floor.floor}-${p}`} sx={{ height: h, display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, ...chessCell() }}>
                {here.length ? (
                  here.map((room) => (
                    <RoomTile key={room.id} room={room} tile={tile} layer={layer} swatches={swatches} compact={here.length > 1} selected={Boolean(selected?.has(room.id))} />
                  ))
                ) : (
                  <Box sx={chess ? { flex: 1, bgcolor: surface.s2, opacity: 0.55 } : { flex: 1, borderRadius: '8px', border: `1px dashed ${surface.hair}` }} />
                )}
              </Box>
            );
          })}
          {onAdd ? (
            <Box sx={{ display: 'flex', alignItems: 'center', pl: chess ? 0.5 : 0 }}>
              <ButtonBase
                onClick={(e) => {
                  e.stopPropagation();
                  onAdd(floor.floor);
                }}
                aria-label={t('admin.card.rooms.add.onFloor', { floor: floor.floor || '—' })}
                title={t('admin.card.rooms.add.onFloor', { floor: floor.floor || '—' })}
                data-testid={`admin-rooms-add-floor-${floor.floor || 'none'}`}
                sx={{
                  height: Math.min(h, 32),
                  width: plusWidth,
                  borderRadius: '8px',
                  border: `1px dashed ${surface.line}`,
                  color: ink.low,
                  '&:hover': { color: accent.soft, borderColor: accent.main, bgcolor: accent.washSoft },
                }}
              >
                <AddIcon sx={{ fontSize: 16 }} />
              </ButtonBase>
            </Box>
          ) : null}
        </FloorRow>
      ))}
    </Box>
  );
}

function FloorRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/* ── Плитка номера ──────────────────────────────────────────────────────── */

const BADGE: Record<Tone, ReactNode> = {
  ok: <CheckCircleIcon />,
  warn: <ErrorOutlineIcon />,
  bad: <BlockIcon />,
  off: <RemoveCircleOutlineIcon />,
  info: null,
};

function RoomTile({ room, tile, layer, swatches, compact, selected }: { room: MapRoom; tile: Tile; layer: Layer; swatches: Swatches; compact: boolean; selected: boolean }) {
  const s = swatches.swatchOf(room, layer);
  const common = {
    role: 'button',
    tabIndex: 0,
    'aria-label': `${room.number}: ${s.label}`,
    'aria-pressed': selected,
    'data-testid': `admin-room-${room.number}`,
    'data-room-id': room.id,
    'data-v': s.value,
    'data-selected': selected ? 'true' : undefined,
  } as const;
  // Выбранный номер (63-2): рамка цвета выбора и галочка — не только цвет.
  const chosen = selected
    ? {
        outline: `3px solid ${accent.main}`,
        outlineOffset: tile === 'c' ? '-3px' : '1px',
        '&::before': {
          content: '"✓"',
          position: 'absolute',
          left: -6,
          top: -6,
          width: 16,
          height: 16,
          borderRadius: '50%',
          bgcolor: accent.main,
          color: surface.s1,
          fontSize: 10,
          fontWeight: 800,
          display: 'grid',
          placeItems: 'center',
          zIndex: 2,
        },
      }
    : {};
  const longNumber = room.number.length > 5;
  if (tile === 'c') {
    return (
      <Box
        {...common}
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          alignContent: 'center',
          justifyItems: 'center',
          bgcolor: s.tone === 'ok' ? surface.s1 : mix(s.base, surface.s1, s.tone === 'off' ? 10 : 16),
          boxShadow: `inset 0 -3px 0 ${s.base}`,
          opacity: room.is_active ? 1 : 0.6,
          cursor: 'pointer',
          position: 'relative',
          transition: 'opacity .12s',
          '&:hover, &:focus-visible': { outline: `2px solid ${accent.main}`, outlineOffset: '-1px', zIndex: 1 },
          ...chosen,
        }}
      >
        <Box sx={{ fontSize: longNumber ? 9.5 : 11, fontWeight: 800, color: ink.hi, lineHeight: 1.1, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', px: '2px' }}>
          {room.number}
        </Box>
        {!compact ? (
          <Box sx={{ fontSize: 8.5, fontWeight: 700, color: s.tone === 'ok' ? ink.low : TONE[s.tone], lineHeight: 1.1, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', px: '2px' }}>
            {swatches.wordOf(room, layer, true)}
          </Box>
        ) : null}
      </Box>
    );
  }
  if (tile === 'b') {
    return (
      <Box
        {...common}
        sx={{
          flex: 1,
          minHeight: 0,
          boxSizing: 'border-box',
          position: 'relative',
          borderRadius: '10px',
          bgcolor: surface.s1,
          border: `1px solid ${surface.hair}`,
          boxShadow: `0 1px 2px ${mix(ink.hi, 'transparent', 10)}, 0 2px 6px ${mix(ink.hi, 'transparent', 6)}`,
          px: 0.9,
          py: compact ? 0.2 : 0.6,
          display: 'grid',
          alignContent: 'space-between',
          opacity: room.is_active ? 1 : 0.55,
          cursor: 'pointer',
          transition: 'transform .12s ease, box-shadow .12s ease, opacity .12s',
          '&:hover, &:focus-visible': { transform: 'translateY(-3px)', boxShadow: `0 10px 22px ${mix(ink.hi, 'transparent', 20)}`, outline: 'none' },
          ...chosen,
        }}
      >
        <Box sx={{ position: 'absolute', top: 5, right: 5, color: TONE[s.tone], display: 'grid', '& svg': { fontSize: 16 } }} aria-hidden>
          {BADGE[s.tone] ?? (
            <Box component="span" sx={{ width: 16, height: 16, borderRadius: '50%', bgcolor: s.base, color: surface.s1, fontSize: 10, fontWeight: 800, display: 'grid', placeItems: 'center' }}>
              {s.glyph}
            </Box>
          )}
        </Box>
        <Box sx={{ pr: 2.25, minWidth: 0 }}>
          <Box sx={{ fontSize: longNumber ? 12.5 : 15, fontWeight: 800, color: ink.hi, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{room.number}</Box>
          {!compact ? (
            <Box sx={{ fontSize: 10, color: ink.low, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} data-words="data">
              {room.category || ' '}
            </Box>
          ) : null}
        </Box>
        {!compact ? (
          <Box sx={{ fontSize: 10.5, fontWeight: 700, color: s.tone === 'ok' ? ink.mid : TONE[s.tone], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {swatches.wordOf(room, layer)}
          </Box>
        ) : null}
      </Box>
    );
  }
  const hasVariant = Boolean(room.variant) && !room.problems.includes('not_published');
  const linked = !room.problems.includes('no_link');
  const icon = (ok: boolean, on: ReactNode, off: ReactNode) => (
    <Box component="span" aria-hidden sx={{ display: 'inline-grid', color: ok ? ink.low : state.bad, '& svg': { fontSize: 13 } }}>
      {ok ? on : off}
    </Box>
  );
  return (
    <Box
      {...common}
      sx={{
        flex: 1,
        minHeight: 0,
        boxSizing: 'border-box',
        borderRadius: '8px',
        bgcolor: surface.s1,
        border: `1px solid ${surface.line}`,
        borderLeft: `5px solid ${s.base}`,
        backgroundImage: s.hatch ? `linear-gradient(90deg, ${mix(s.base, surface.s1, 12)} 0 6px, transparent 6px)` : 'none',
        pl: 0.75,
        pr: 0.5,
        py: 0.4,
        display: 'grid',
        gridTemplateRows: compact ? '1fr' : '1fr auto',
        opacity: room.is_active ? 1 : 0.55,
        cursor: 'pointer',
        transition: 'transform .12s ease, box-shadow .12s ease, opacity .12s',
        '&:hover, &:focus-visible': { transform: 'translateY(-2px)', boxShadow: `0 6px 14px ${mix(ink.hi, 'transparent', 18)}`, borderColor: accent.main, outline: 'none' },
        position: 'relative',
        ...chosen,
      }}
    >
      <Box sx={{ fontSize: longNumber ? 12 : 15, fontWeight: 800, color: ink.hi, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{room.number}</Box>
      {!compact ? (
        <Box sx={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          {icon(hasVariant, <LayersOutlinedIcon />, <LayersClearOutlinedIcon />)}
          {icon(room.pin, <KeyOutlinedIcon />, <KeyOffOutlinedIcon />)}
          {icon(linked, <WifiOutlinedIcon />, <WifiOffOutlinedIcon />)}
        </Box>
      ) : null}
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
  return { hover, handlers, clear: () => setHover(null) };
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
