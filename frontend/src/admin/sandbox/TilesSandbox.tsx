import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
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

import { accent, ink, panelSx, shape, state, surface, typo } from '../adminTokens';
import { getHotelsView, getRoomsMap, type MapBuilding, type MapRoom, type RoomProblem } from '../adminClient';

/**
 * ПЛИТКА НОМЕРА — ТРИ ВИДА НА ВЫБОР (63-1, шаг 1).
 *
 *   А «Полоса»    — крупный номер, цветная полоса слева, три значка снизу:
 *                   вариант, PIN, связь (зачёркнутый значок — нет);
 *   Б «Карточка»  — карточка с тенью, значок состояния в углу, категория и
 *                   первая причина словами;
 *   В «Шахматка»  — плотная таблица, как в гостиничных системах: номер и
 *                   слово состояния в клетке, сетка линиями.
 *
 * Общее: состояние читается без легенды (значок и слово, а не только цвет),
 * наведение поднимает плитку или обводит клетку. Большой корпус не листается
 * вбок: ряд позиций режется на части по ширине экрана («позиции 00–24»,
 * «25–49»…), стояки внутри части по-прежнему друг под другом.
 */

type Tone = 'ok' | 'warn' | 'bad' | 'off';
interface Status {
  tone: Tone;
  word: string;
}

const PROBLEM_WORDS: Record<RoomProblem, string> = {
  no_link: 'нет связи',
  no_variant: 'нет варианта',
  not_published: 'не опубликован',
  no_pin: 'нет PIN',
  demo_entry: 'вход без PIN',
};
const BLOCKING: RoomProblem[] = ['no_link', 'no_variant', 'not_published', 'no_pin'];

function statusOf(room: MapRoom): Status {
  if (room.control === 'off') return { tone: 'off', word: room.is_active ? 'не подключено' : 'выключен' };
  if (room.control === 'ok') return { tone: 'ok', word: 'готов' };
  if (room.control === 'attention') return { tone: 'warn', word: PROBLEM_WORDS.demo_entry };
  const first = BLOCKING.find((code) => room.problems.includes(code));
  return { tone: 'bad', word: first ? PROBLEM_WORDS[first] : 'мешает гостю' };
}

const TONE: Record<Tone, string> = { ok: state.ok, warn: state.warn, bad: state.bad, off: ink.low };
const mix = (a: string, b: string, pa: number) => `color-mix(in srgb, ${a} ${pa}%, ${b})`;

/** Образец разнообразия: у снимков стенда все номера одинаковы — для выбора плитки раскрашиваем. */
function seeded(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}
function sampled(room: MapRoom): MapRoom {
  const r = seeded(room.number);
  if (r < 0.55) return { ...room, control: 'ok', problems: [], pin: true, variant: room.variant ?? { code: 'std', title: 'Стандарт' } };
  if (r < 0.7) return { ...room, control: 'attention', problems: ['demo_entry'], pin: false, variant: room.variant ?? { code: 'std', title: 'Стандарт' } };
  if (r < 0.85) return { ...room, control: 'blocked', problems: ['no_variant'], pin: true, variant: null };
  if (r < 0.93) return { ...room, control: 'blocked', problems: ['no_pin'], pin: false, variant: { code: 'lux', title: 'Люкс' } };
  if (r < 0.97) return { ...room, control: 'blocked', problems: ['no_link'], pin: true, variant: { code: 'std', title: 'Стандарт' } };
  return { ...room, control: 'off', problems: [], is_active: false };
}

const VARIANTS = [
  { key: 'a', title: 'А · Полоса', idea: 'крупный номер; цвет — только узкая полоса слева, плитка остаётся светлой; снизу три значка: вариант, PIN, связь — зачёркнутый значок значит «нет».' },
  { key: 'b', title: 'Б · Карточка', idea: 'карточка с тенью, в углу значок состояния (галочка, восклицание, запрет); под номером — категория мелко и первая причина словами.' },
  { key: 'c', title: 'В · Шахматка', idea: 'плотная таблица с линиями, как «шахматка» гостиничных систем: в клетке номер и слово состояния, фон — лёгкий оттенок; больше всего номеров на экран.' },
];
const HOTELS = [
  { sub: 'crystal', title: '«Кристалл»' },
  { sub: 'snap-metropol', title: 'Метрополь · снимок' },
  { sub: 'snap-sialia', title: 'Сиалия · снимок' },
];

export function TilesSandbox() {
  const [params, setParams] = useSearchParams();
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (!v) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  const v = params.get('v') || 'a';
  const sub = params.get('hotel') || 'snap-metropol';
  const sample = params.get('mix') === '1';
  const fleet = useQuery({ queryKey: ['sandbox631', 'fleet'], queryFn: () => getHotelsView({ layout: 'list', origin: 'all' }) });
  const hotelId = fleet.data?.items.find((h) => h.subdomain === sub)?.id ?? null;
  const map = useQuery({ queryKey: ['sandbox631', 'map', hotelId], enabled: Boolean(hotelId), queryFn: () => getRoomsMap(hotelId!, {}) });
  const buildings = useMemo(
    () =>
      (map.data?.buildings ?? []).map((b) => (sample ? { ...b, floors: b.floors.map((f) => ({ ...f, rooms: f.rooms.map(sampled) })) } : b)),
    [map.data, sample],
  );
  const chip = (on: boolean, label: ReactNode, onClick: () => void, testId: string) => (
    <ButtonBase
      key={testId}
      onClick={onClick}
      data-testid={testId}
      aria-pressed={on}
      sx={{
        px: 1.25,
        py: 0.6,
        borderRadius: `${shape.pill}px`,
        ...typo.caption,
        fontWeight: 700,
        border: `1px solid ${on ? accent.main : surface.line}`,
        color: on ? accent.soft : ink.mid,
        bgcolor: on ? accent.washSoft : surface.s1,
      }}
    >
      {label}
    </ButtonBase>
  );

  return (
    <Box data-testid="sandbox-tiles" sx={{ minWidth: 0 }}>
      <Typography component="h1" sx={{ ...typo.pageTitle, color: ink.hi, mb: 0.5 }}>
        Плитка номера — на выбор
      </Typography>
      <Typography sx={{ ...typo.body, color: ink.mid, mb: 2, maxWidth: 820 }}>
        Три разных вида одной и той же схемы. Состояние читается без легенды — значком и словом; наведите на номер — плитка отзовётся. Большой корпус режется на части по ширине экрана, вбок ничего не листается.
      </Typography>
      <Box sx={{ ...panelSx, p: 1.5, mb: 1.5, display: 'grid', gap: 1 }}>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>{VARIANTS.map((x) => chip(v === x.key, x.title, () => set({ v: x.key === 'a' ? null : x.key }), `sandbox-tile-${x.key}`))}</Box>
        <Box sx={{ ...typo.body, color: ink.mid }}>
          <b>Идея:</b> {VARIANTS.find((x) => x.key === v)?.idea}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
        <Box sx={{ ...typo.label, color: ink.mid }}>Отель</Box>
        {HOTELS.map((h) => chip(sub === h.sub, h.title, () => set({ hotel: h.sub === 'snap-metropol' ? null : h.sub }), `sandbox-hotel-${h.sub}`))}
        <Box sx={{ flex: 1 }} />
        <Box component="label" sx={{ display: 'flex', alignItems: 'center', ...typo.caption, color: ink.mid }}>
          <Switch size="small" checked={sample} onChange={(e) => set({ mix: e.target.checked ? '1' : null })} data-testid="sandbox-mix" />
          разные состояния
          <Box component="span" sx={{ ml: 0.75, px: 0.75, borderRadius: 999, border: `1px dashed ${state.gold}`, color: state.gold, fontWeight: 700 }}>образец</Box>
        </Box>
      </Box>
      {!hotelId && fleet.isSuccess ? <Box sx={{ ...typo.body, color: ink.mid }}>Этого отеля нет локально.</Box> : null}
      <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
        {buildings.map((b) => (
          <Box key={b.key || 'none'} sx={{ ...panelSx, p: { xs: 1.25, md: 2 }, minWidth: 0 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', mb: 1 }}>
              <Typography component="h3" sx={{ ...typo.panelTitle, color: ink.hi }}>{b.title || 'Без корпуса'}</Typography>
              <Box sx={{ ...typo.caption, color: ink.low }}>номеров: {b.rooms}</Box>
            </Box>
            <Rack building={b} variant={v} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/* ── Раскладка: этажи × позиции, ряд режется на части по ширине ─────────── */

function useWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
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

const SIZES: Record<string, { w: number; h: number; gap: number; wPhone: number; hPhone: number }> = {
  a: { w: 64, h: 52, gap: 6, wPhone: 56, hPhone: 48 },
  b: { w: 92, h: 66, gap: 8, wPhone: 76, hPhone: 62 },
  c: { w: 46, h: 32, gap: 0, wPhone: 42, hPhone: 30 },
};

function Rack({ building, variant }: { building: MapBuilding; variant: string }) {
  const [ref, width] = useWidth();
  const phone = useMediaQuery('(max-width:599px)');
  const size = SIZES[variant] ?? SIZES.a;
  const w = phone ? size.wPhone : size.w;
  const h = phone ? size.hPhone : size.h;
  const label = phone ? 34 : 52;
  const positions = useMemo(() => {
    const list = [...building.positions];
    if (building.floors.some((f) => f.rooms.some((r) => !r.position))) list.push('');
    return list;
  }, [building]);
  // Сколько позиций влезает в ряд; ряд режется на равные части.
  const fit = Math.max(1, Math.floor((width - label + size.gap) / (w + size.gap)));
  const parts = Math.max(1, Math.ceil(positions.length / fit));
  const per = Math.ceil(positions.length / parts);
  const chunks = Array.from({ length: parts }, (_, i) => positions.slice(i * per, (i + 1) * per)).filter((c) => c.length);

  return (
    <Box ref={ref} sx={{ display: 'grid', gap: 2, minWidth: 0 }} data-testid={`sandbox-rack-${building.key || 'none'}`}>
      {width > 0
        ? chunks.map((chunk, i) => (
            <Box key={i} sx={{ minWidth: 0 }}>
              {chunks.length > 1 ? (
                <Box sx={{ ...typo.caption, color: ink.low, mb: 0.5 }}>
                  позиции {chunk[0] || '—'}–{chunk[chunk.length - 1] || '—'}
                </Box>
              ) : null}
              {variant === 'c' ? (
                <ChessPart building={building} positions={chunk} w={w} h={h} label={label} phone={phone} />
              ) : (
                <GridPart building={building} positions={chunk} w={w} h={h} gap={size.gap} label={label} phone={phone} variant={variant} />
              )}
            </Box>
          ))
        : null}
    </Box>
  );
}

function floorText(floor: string, phone: boolean) {
  if (!floor) return '—';
  return phone ? floor : `${floor} эт.`;
}

function GridPart({ building, positions, w, h, gap, label, phone, variant }: { building: MapBuilding; positions: string[]; w: number; h: number; gap: number; label: number; phone: boolean; variant: string }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `${label}px repeat(${positions.length}, ${w}px)`, gap: `${gap}px`, alignItems: 'center' }}>
      <Box />
      {positions.map((p) => (
        <Box key={`h${p}`} sx={{ ...typo.caption, fontSize: 10.5, color: ink.low, textAlign: 'center' }}>{p || '—'}</Box>
      ))}
      {building.floors.map((f) => (
        <FloorCells key={f.floor} floor={f.floor} rooms={f.rooms} positions={positions} phone={phone}>
          {(room) => (room ? (variant === 'b' ? <CardTile room={room} w={w} h={h} /> : <StripeTile room={room} w={w} h={h} />) : <Box sx={{ width: w, height: h, borderRadius: '8px', border: `1px dashed ${surface.hair}` }} />)}
        </FloorCells>
      ))}
    </Box>
  );
}

function FloorCells({ floor, rooms, positions, phone, children }: { floor: string; rooms: MapRoom[]; positions: string[]; phone: boolean; children: (room: MapRoom | null) => ReactNode }) {
  return (
    <>
      <Box sx={{ ...typo.caption, fontWeight: 700, color: ink.mid, whiteSpace: 'nowrap' }}>{floorText(floor, phone)}</Box>
      {positions.map((p) => {
        const room = rooms.find((r) => r.position === p) ?? null;
        return <Box key={`${floor}-${p}`}>{children(room)}</Box>;
      })}
    </>
  );
}

const lift = {
  transition: 'transform .12s ease, box-shadow .12s ease',
  '&:hover': { transform: 'translateY(-2px)' },
};

/* ── А · Полоса ─────────────────────────────────────────────────────────── */

function StripeTile({ room, w, h }: { room: MapRoom; w: number; h: number }) {
  const s = statusOf(room);
  const hasVariant = Boolean(room.variant) && !room.problems.includes('not_published');
  const linked = !room.problems.includes('no_link');
  const icon = (ok: boolean, on: ReactNode, off: ReactNode, title: string) => (
    <Box component="span" title={title} sx={{ display: 'inline-grid', color: ok ? ink.low : state.bad, '& svg': { fontSize: 13 } }}>
      {ok ? on : off}
    </Box>
  );
  return (
    <Box
      data-testid={`tile-${room.number}`}
      title={`${room.number}: ${s.word}`}
      sx={{
        ...lift,
        width: w,
        height: h,
        boxSizing: 'border-box',
        position: 'relative',
        borderRadius: '8px',
        bgcolor: surface.s1,
        border: `1px solid ${surface.line}`,
        borderLeft: `5px solid ${TONE[s.tone]}`,
        pl: 0.75,
        pr: 0.5,
        py: 0.4,
        display: 'grid',
        gridTemplateRows: '1fr auto',
        opacity: room.is_active ? 1 : 0.55,
        cursor: 'pointer',
        '&:hover': { transform: 'translateY(-2px)', boxShadow: `0 6px 14px ${mix(ink.hi, 'transparent', 18)}`, borderColor: accent.main },
      }}
    >
      <Box sx={{ fontSize: room.number.length > 4 ? 12 : 15, fontWeight: 800, color: ink.hi, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {room.number}
      </Box>
      <Box sx={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
        {icon(hasVariant, <LayersOutlinedIcon />, <LayersClearOutlinedIcon />, hasVariant ? 'вариант есть' : 'нет варианта')}
        {icon(room.pin, <KeyOutlinedIcon />, <KeyOffOutlinedIcon />, room.pin ? 'PIN есть' : 'нет PIN')}
        {icon(linked, <WifiOutlinedIcon />, <WifiOffOutlinedIcon />, linked ? 'на связи' : 'нет связи')}
      </Box>
    </Box>
  );
}

/* ── Б · Карточка ───────────────────────────────────────────────────────── */

const BADGE: Record<Tone, ReactNode> = {
  ok: <CheckCircleIcon />,
  warn: <ErrorOutlineIcon />,
  bad: <BlockIcon />,
  off: <RemoveCircleOutlineIcon />,
};

function CardTile({ room, w, h }: { room: MapRoom; w: number; h: number }) {
  const s = statusOf(room);
  return (
    <Box
      data-testid={`tile-${room.number}`}
      title={`${room.number}: ${s.word}`}
      sx={{
        ...lift,
        width: w,
        height: h,
        boxSizing: 'border-box',
        position: 'relative',
        borderRadius: '10px',
        bgcolor: surface.s1,
        border: `1px solid ${surface.hair}`,
        boxShadow: `0 1px 2px ${mix(ink.hi, 'transparent', 10)}, 0 2px 6px ${mix(ink.hi, 'transparent', 6)}`,
        px: 0.9,
        py: 0.6,
        display: 'grid',
        alignContent: 'space-between',
        opacity: room.is_active ? 1 : 0.55,
        cursor: 'pointer',
        '&:hover': { transform: 'translateY(-3px)', boxShadow: `0 10px 22px ${mix(ink.hi, 'transparent', 20)}` },
      }}
    >
      <Box sx={{ position: 'absolute', top: 5, right: 5, color: TONE[s.tone], display: 'grid', '& svg': { fontSize: 16 } }} aria-hidden>
        {BADGE[s.tone]}
      </Box>
      <Box sx={{ pr: 2.25, minWidth: 0 }}>
        <Box sx={{ fontSize: room.number.length > 5 ? 12.5 : 15, fontWeight: 800, color: ink.hi, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{room.number}</Box>
        <Box sx={{ fontSize: 10, color: ink.low, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{room.category || 'без категории'}</Box>
      </Box>
      <Box sx={{ fontSize: 10.5, fontWeight: 700, color: s.tone === 'ok' ? ink.mid : TONE[s.tone], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.word}</Box>
    </Box>
  );
}

/* ── В · Шахматка ───────────────────────────────────────────────────────── */

function ChessPart({ building, positions, w, h, label, phone }: { building: MapBuilding; positions: string[]; w: number; h: number; label: number; phone: boolean }) {
  const line = `1px solid ${surface.line}`;
  return (
    <Box component="table" sx={{ borderCollapse: 'collapse', tableLayout: 'fixed', '& td, & th': { border: line, p: 0 } }}>
      <Box component="thead">
        <Box component="tr">
          <Box component="th" sx={{ width: label, bgcolor: surface.s2 }} />
          {positions.map((p) => (
            <Box component="th" key={p} sx={{ width: w, height: 20, bgcolor: surface.s2, ...typo.caption, fontSize: 10, fontWeight: 700, color: ink.low }}>{p || '—'}</Box>
          ))}
        </Box>
      </Box>
      <Box component="tbody">
        {building.floors.map((f) => (
          <Box component="tr" key={f.floor}>
            <Box component="th" sx={{ bgcolor: surface.s2, ...typo.caption, fontWeight: 700, color: ink.mid, px: 0.5, textAlign: 'start', whiteSpace: 'nowrap' }}>{floorText(f.floor, phone)}</Box>
            {positions.map((p) => {
              const room = f.rooms.find((r) => r.position === p);
              return <Box component="td" key={p}>{room ? <ChessCell room={room} h={h} /> : <Box sx={{ height: h, bgcolor: surface.s2, opacity: 0.5 }} />}</Box>;
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** Слова шахматки — короче: клетка в 46 точек, полное «нет варианта» обрезалось. */
const SHORT: Record<string, string> = {
  готов: 'готов',
  'нет связи': 'нет связи',
  'нет варианта': 'нет вар.',
  'не опубликован': 'черновик',
  'нет PIN': 'нет PIN',
  'вход без PIN': 'демо',
  'не подключено': 'не подкл.',
  выключен: 'выкл.',
  'мешает гостю': 'мешает',
};

function ChessCell({ room, h }: { room: MapRoom; h: number }) {
  const full = statusOf(room);
  const s = { ...full, word: SHORT[full.word] ?? full.word };
  return (
    <Box
      data-testid={`tile-${room.number}`}
      title={`${room.number}: ${full.word}`}
      sx={{
        height: h,
        display: 'grid',
        alignContent: 'center',
        justifyItems: 'center',
        bgcolor: s.tone === 'ok' ? surface.s1 : mix(TONE[s.tone], surface.s1, s.tone === 'off' ? 10 : 16),
        boxShadow: `inset 0 -3px 0 ${TONE[s.tone]}`,
        opacity: room.is_active ? 1 : 0.6,
        cursor: 'pointer',
        position: 'relative',
        '&:hover': { outline: `2px solid ${accent.main}`, outlineOffset: '-1px', zIndex: 1 },
      }}
    >
      <Box sx={{ fontSize: room.number.length > 4 ? 9.5 : 11, fontWeight: 800, color: ink.hi, lineHeight: 1.1, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', px: '2px' }}>{room.number}</Box>
      <Box sx={{ fontSize: 8.5, fontWeight: 700, color: s.tone === 'ok' ? ink.low : TONE[s.tone], lineHeight: 1.1, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', px: '2px' }}>{s.word}</Box>
    </Box>
  );
}
