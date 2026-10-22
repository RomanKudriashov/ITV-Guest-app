import { useMemo, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import useMediaQuery from '@mui/material/useMediaQuery';
import TableRowsOutlinedIcon from '@mui/icons-material/TableRowsOutlined';
import ViewModuleOutlinedIcon from '@mui/icons-material/ViewModuleOutlined';
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';

import { accent, ink, panelSx, primaryButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../adminTokens';
import { Empty, FilterBar, Help, Panel, Pill, ViewSwitch, useFacetValues, type Facet } from '../pages/hotels/hotelsUi';
import { SortBar, SortHeader, sortRows, useSort, type SortColumn } from '../sort';
import { STAND_HOTELS, layout, naturalCompare, useLocalHotel, useLocalHotels, type BuildingLayout, type Layer, type MockHotel, type MockRoom } from './roomsData';
import { LAYERS, Legend, MockAction, PageHead, RoomTip, Sample, SelectionBar, VariantBar, paint, useGo, type VariantInfo } from './ui';

/**
 * МАКЕТ 1 — НОМЕРНОЙ ФОНД (партия 63-М). Три варианта:
 *   А «Три вида»          — Таблица · Блоки · Схема-шахматка, слой цветом;
 *   Б «Фасад»             — корпус рисуется зданием, справа — панель номера;
 *   В «Сначала проблемы»  — очередь «что исправить», ниже тепловая карта.
 */

const VARIANTS: VariantInfo[] = [
  { key: 'a', title: 'Вариант А · Три вида', idea: 'один экран, три взгляда на те же номера: таблица для поиска, блоки для обзора, схема-шахматка «этажи × стояки» для групповых правок; цвет — выбранный слой.' },
  { key: 'b', title: 'Вариант Б · Фасад', idea: 'каждый корпус нарисован зданием (этажи — полосы, номера — окна), справа постоянная панель выбранного номера или группы с действиями.' },
  { key: 'c', title: 'Вариант В · Сначала проблемы', idea: 'сверху — что мешает и сколько, кнопкой «исправить» сразу на группу; ниже компактная тепловая карта всего отеля, щелчок по этажу раскрывает его.' },
];

const HOTEL_KEYS = ['metropol', 'sialia'] as const;

function useHotel(): { hotel: MockHotel | null; picker: ReactNode } {
  const [params, go] = useGo();
  const chosen = params.get('hotel') || 'metropol';
  const locals = useLocalHotels();
  const localId = chosen.startsWith('local:') ? chosen.slice(6) : null;
  const local = useLocalHotel(localId);
  const localRows = (locals.data?.items ?? []).filter((r) => r.is_active && r.counts.rooms > 0).slice(0, 6);
  const hotel = localId ? (local.data ? { ...local.data, name: localRows.find((r) => r.id === localId)?.name ?? 'Локальный отель' } : null) : STAND_HOTELS[chosen as 'metropol'] ?? STAND_HOTELS.metropol;
  const chip = (key: string, label: ReactNode) => (
    <ButtonBase
      key={key}
      onClick={() => go({ hotel: key, sel: null, floor: null })}
      data-testid={`sandbox-hotel-${key}`}
      sx={{
        px: 1.25,
        py: 0.5,
        borderRadius: `${shape.pill}px`,
        ...typo.caption,
        fontWeight: 700,
        border: `1px solid ${chosen === key ? accent.main : surface.line}`,
        color: chosen === key ? accent.soft : ink.mid,
        bgcolor: chosen === key ? accent.washSoft : surface.s2,
        gap: 0.75,
      }}
    >
      {label}
    </ButtonBase>
  );
  return {
    hotel,
    picker: (
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }} data-testid="sandbox-hotels">
        <Box sx={{ ...typo.label, color: ink.mid, mr: 0.5 }}>Отель</Box>
        {HOTEL_KEYS.map((key) =>
          chip(key, (
            <>
              {STAND_HOTELS[key].name} · {STAND_HOTELS[key].rooms.length}
              <Box component="span" sx={{ color: ink.low, fontWeight: 600 }}>снимок стенда</Box>
            </>
          )),
        )}
        {localRows.map((r) => chip(`local:${r.id}`, `${r.name} · ${r.counts.rooms}`))}
      </Box>
    ),
  };
}

/** Поиск и фильтры: номер; корпус, этаж, вариант, PIN — чипами в адресе. */
function useFiltered(hotel: MockHotel | null) {
  const [params] = useGo();
  const values = useFacetValues(['building', 'floor', 'variant', 'pin']);
  const q = (params.get('search') ?? '').trim().toLowerCase();
  const rooms = hotel?.rooms ?? [];
  const shown = rooms.filter(
    (r) =>
      (!q || r.number.toLowerCase().includes(q)) &&
      (!values.building.length || values.building.includes(r.building || '—')) &&
      (!values.floor.length || values.floor.includes(r.floor || '—')) &&
      (!values.variant.length || values.variant.includes(r.variant ?? '—')) &&
      (!values.pin.length || values.pin.includes(r.pin ? 'yes' : 'no')),
  );
  const count = (pick: (r: MockRoom) => string) => {
    const map = new Map<string, number>();
    for (const r of rooms) map.set(pick(r), (map.get(pick(r)) ?? 0) + 1);
    return [...map.entries()].sort(([a], [b]) => naturalCompare(a, b));
  };
  const facets: Facet[] = [
    ...(new Set(rooms.map((r) => r.building)).size > 1
      ? [{ key: 'building', label: 'Корпус', options: count((r) => r.building || '—').map(([value, n]) => ({ value, label: value === '—' ? 'без корпуса' : value, count: n })) }]
      : []),
    { key: 'floor', label: 'Этаж', options: count((r) => r.floor || '—').map(([value, n]) => ({ value, label: value === '—' ? 'без этажа' : `${value} этаж`, count: n })) },
    { key: 'variant', label: 'Вариант', options: count((r) => r.variant ?? '—').map(([value, n]) => ({ value, label: value === '—' ? 'без варианта' : value, count: n })) },
    { key: 'pin', label: 'PIN', options: [{ value: 'yes', label: 'есть', tone: 'ok' as const, count: rooms.filter((r) => r.pin).length }, { value: 'no', label: 'нет', tone: 'warn' as const, count: rooms.filter((r) => !r.pin).length }] },
  ];
  return { shown, facets, q };
}

function LayerPicker({ layer, onChange }: { layer: Layer; onChange: (l: Layer) => void }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }} data-testid="sandbox-layers">
      <Box sx={{ ...typo.label, color: ink.mid, mr: 0.5 }}>Цветом</Box>
      {LAYERS.map((l) => (
        <ButtonBase
          key={l.key}
          onClick={() => onChange(l.key)}
          data-testid={`sandbox-layer-${l.key}`}
          aria-pressed={layer === l.key}
          sx={{
            px: 1.25,
            py: 0.5,
            gap: 0.5,
            borderRadius: `${shape.pill}px`,
            ...typo.caption,
            fontWeight: 700,
            border: `1px solid ${layer === l.key ? accent.main : surface.line}`,
            color: layer === l.key ? accent.soft : ink.mid,
            bgcolor: layer === l.key ? accent.washSoft : 'transparent',
          }}
        >
          {l.label}
          {l.sample ? <Sample /> : null}
        </ButtonBase>
      ))}
      <Help>{LAYERS.find((l) => l.key === layer)?.help}</Help>
    </Box>
  );
}

/** Выбор номеров: клики, Shift, протягивание, «весь этаж/стояк/корпус». */
function useSelection() {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const dragging = useRef<null | boolean>(null);
  return {
    sel,
    set: (keys: string[], on: boolean) =>
      setSel((prev) => {
        const next = new Set(prev);
        for (const k of keys) {
          if (on) next.add(k);
          else next.delete(k);
        }
        return next;
      }),
    toggle: (key: string, ordered: string[], shift: boolean) =>
      setSel((prev) => {
        const next = new Set(prev);
        if (shift && anchor.current) {
          const a = ordered.indexOf(anchor.current);
          const b = ordered.indexOf(key);
          if (a >= 0 && b >= 0) for (const k of ordered.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(k);
        } else if (next.has(key)) next.delete(key);
        else next.add(key);
        anchor.current = key;
        return next;
      }),
    clear: () => setSel(new Set()),
    dragStart: (key: string) => {
      dragging.current = true;
      setSel((prev) => new Set(prev).add(key));
    },
    dragOver: (key: string) => {
      if (dragging.current) setSel((prev) => new Set(prev).add(key));
    },
    dragEnd: () => {
      dragging.current = null;
    },
  };
}

function Actions({ count, onClear }: { count: number; onClear: () => void }) {
  const [dialog, setDialog] = useState<null | 'variant' | 'pin'>(null);
  return (
    <>
      <SelectionBar count={count} onClear={onClear}>
        <Button size="small" sx={primaryButtonSx} onClick={() => setDialog('variant')} data-testid="sandbox-assign-variant">Назначить вариант…</Button>
        <Button size="small" sx={secondaryButtonSx} onClick={() => setDialog('pin')} data-testid="sandbox-issue-pin">Выдать PIN…</Button>
      </SelectionBar>
      {dialog === 'variant' ? (
        <MockAction title={`Назначить вариант — ${count} номерам`} onClose={() => setDialog(null)} confirm="Назначить">
          <Box>Выберите вариант. Номера получат его схему управления; уже опубликованная версия варианта начнёт действовать у них сразу.</Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {['Стандарт', 'Делюкс', 'Люкс', 'Вилла'].map((v) => <Pill key={v} tone="info">{v}</Pill>)}
          </Box>
        </MockAction>
      ) : null}
      {dialog === 'pin' ? (
        <MockAction title={`Выдать PIN — ${count} номерам`} onClose={() => setDialog(null)} confirm="Выдать">
          <Box>У каждого номера появится свой PIN; действующие будут заменены. PIN увидит только тот, кто его выдаёт, — один раз.</Box>
        </MockAction>
      ) : null}
    </>
  );
}

export function RoomsMock() {
  const [params, go] = useGo();
  const v = params.get('v') || 'a';
  const layer = (params.get('layer') as Layer) || 'control';
  const { hotel, picker } = useHotel();
  const { shown, facets } = useFiltered(hotel);
  const variants = useMemo(() => [...new Set((hotel?.rooms ?? []).map((r) => r.variant).filter(Boolean) as string[])].sort(naturalCompare), [hotel]);
  const derived = hotel?.rooms.some((r) => r.derived);
  return (
    <Box data-testid="sandbox-rooms">
      <PageHead
        title="Номерной фонд"
        subtitle="Все номера отеля: где они, какой у каждого вариант управления, есть ли PIN и что мешает. Выберите номера — щелчком, протягиванием, с Shift, целым этажом, стояком или корпусом — и назначьте им вариант или выдайте PIN."
      />
      <VariantBar variants={VARIANTS} value={v} onChange={(key) => go({ v: key, sel: null, floor: null })} />
      {picker}
      {!hotel ? <Panel><Box sx={{ ...typo.body, color: ink.mid }}>Загружаю номера…</Box></Panel> : null}
      {hotel ? (
        <>
          {hotel.source === 'stand' ? (
            <Box sx={{ ...typo.caption, color: ink.mid, mb: 1, display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
              <Sample>образец</Sample> варианты и PIN на стенде ещё не заданы — здесь разложены образцом по категории; номера, корпуса и категории — настоящие.
              {derived ? <> Этажи выведены из номера («2205» — 2 этаж).</> : null}
            </Box>
          ) : null}
          {v === 'a' ? <ThreeViews hotel={hotel} rooms={shown} facets={facets} layer={layer} variants={variants} /> : null}
          {v === 'b' ? <Facade hotel={hotel} rooms={shown} facets={facets} layer={layer} variants={variants} /> : null}
          {v === 'c' ? <ProblemsFirst hotel={hotel} rooms={shown} facets={facets} layer={layer} variants={variants} /> : null}
        </>
      ) : null}
    </Box>
  );
}

interface ViewProps {
  hotel: MockHotel;
  rooms: MockRoom[];
  facets: Facet[];
  layer: Layer;
  variants: string[];
}

/* ── Вариант А: три вида ─────────────────────────────────────────────────── */

function ThreeViews({ hotel, rooms, facets, layer, variants }: ViewProps) {
  const [params, go] = useGo();
  const narrow = useMediaQuery('(max-width:899px)');
  const view = (params.get('view') as 'table' | 'blocks' | 'scheme') || 'scheme';
  const selection = useSelection();
  const sort = useSort('', ['number', 'building', 'floor', 'position', 'category', 'variant', 'pin', 'state']);
  const columns: SortColumn<MockRoom>[] = [
    { key: 'number', label: 'Номер', kind: 'natural', get: (r) => r.number },
    { key: 'building', label: 'Корпус', kind: 'natural', get: (r) => r.building || null },
    { key: 'floor', label: 'Этаж', kind: 'natural', get: (r) => r.floor || null },
    { key: 'position', label: 'Стояк', kind: 'natural', get: (r) => r.position || null },
    { key: 'category', label: 'Категория', kind: 'text', get: (r) => r.category || null },
    { key: 'variant', label: 'Вариант', kind: 'text', get: (r) => r.variant },
    { key: 'pin', label: 'PIN', kind: 'rank', get: (r) => (r.pin ? 'yes' : 'no'), rank: ['no', 'yes'] },
    { key: 'state', label: 'Состояние', kind: 'rank', get: (r) => paint(r, 'control', variants).value, rank: ['bad', 'warn', 'ok', 'inactive'] },
  ];
  const ordered = sortRows(rooms, columns, sort, 'number');
  const keys = ordered.map((r) => r.key);
  return (
    <Box>
      <FilterBar
        facets={facets}
        placeholder="Номер"
        aside={
          <ViewSwitch
            label="Вид"
            value={view}
            testIdPrefix="sandbox-rooms-view"
            onChange={(next) => go({ view: next === 'scheme' ? null : next })}
            options={[
              ['table', 'Таблица', <TableRowsOutlinedIcon key="t" fontSize="small" />],
              ['blocks', 'Блоки', <ViewModuleOutlinedIcon key="b" fontSize="small" />],
              ['scheme', 'Схема', <ApartmentOutlinedIcon key="s" fontSize="small" />],
            ]}
          />
        }
      />
      <Box sx={{ ...panelSx, p: 1.25, mb: 1.5, display: 'grid', gap: 1 }}>
        <LayerPicker layer={layer} onChange={(l) => go({ layer: l === 'control' ? null : l })} />
        <Legend rooms={rooms} layer={layer} variants={variants} />
      </Box>
      {!rooms.length ? <Panel><Empty title="Ничего не нашлось">Уберите часть фильтров или измените поиск.</Empty></Panel> : null}
      {rooms.length && view === 'table' ? (
        narrow ? (
          <Box sx={{ display: 'grid', gap: 1 }}>
            <SortBar state={sort} columns={columns} testId="sandbox-rooms-sort" />
            {ordered.map((r) => (
              <ButtonBase
                key={r.key}
                onClick={(e) => selection.toggle(r.key, keys, e.shiftKey)}
                sx={{ ...panelSx, p: 1.25, display: 'flex', gap: 1, alignItems: 'center', textAlign: 'start', outline: selection.sel.has(r.key) ? `2px solid ${accent.main}` : 'none' }}
              >
                <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: paint(r, layer, variants).fill, flex: 'none' }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{r.number}</Box>
                  <Box sx={{ ...typo.caption, color: ink.mid }}>{[r.building, r.floor && `${r.floor} этаж`, r.category].filter(Boolean).join(' · ')}</Box>
                </Box>
                <Pill tone={r.variant ? 'info' : 'muted'}>{r.variant ?? 'без варианта'}</Pill>
              </ButtonBase>
            ))}
          </Box>
        ) : (
          <Box sx={{ ...panelSx, p: 0, overflowX: 'auto' }}>
            <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', ...typo.body, '& td': { px: 1.25, py: 0.9, borderBottom: `1px solid ${surface.hair}` } }}>
              <Box component="thead">
                <Box component="tr">
                  {columns.map((c) => <SortHeader key={c.key} column={c} state={sort} testId={`sandbox-rooms-sort-${c.key}`} />)}
                </Box>
              </Box>
              <Box component="tbody">
                {ordered.map((r) => (
                  <Box
                    component="tr"
                    key={r.key}
                    onClick={(e) => selection.toggle(r.key, keys, e.shiftKey)}
                    sx={{ cursor: 'pointer', bgcolor: selection.sel.has(r.key) ? accent.washSoft : undefined, '&:hover': { bgcolor: surface.s2 } }}
                  >
                    <td>
                      <RoomTip room={r}>
                        <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'center', fontWeight: 700, color: ink.hi }}>
                          <Box component="span" sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: paint(r, layer, variants).fill }} />
                          {r.number}
                        </Box>
                      </RoomTip>
                    </td>
                    <td>{r.building || '—'}</td>
                    <td>{r.floor || '—'}</td>
                    <td>{r.position || '—'}</td>
                    <td>{r.category || '—'}</td>
                    <td>{r.variant ?? <Box component="span" sx={{ color: ink.low }}>не назначен</Box>}</td>
                    <td>{r.pin ? 'есть' : <Box component="span" sx={{ color: state.warn }}>нет</Box>}</td>
                    <td><Pill tone={paint(r, 'control', variants).value === 'ok' ? 'ok' : paint(r, 'control', variants).value === 'bad' ? 'bad' : 'warn'}>{paint(r, 'control', variants).label}</Pill></td>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        )
      ) : null}
      {rooms.length && view === 'blocks' ? (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          {layout(rooms).map((b) => (
            <Panel key={b.building} title={b.building || 'Корпус'} aside={<Box sx={{ ...typo.caption, color: ink.low }}>{b.floors.length} этажей · {[...b.at.values()].length} номеров</Box>}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }} onMouseLeave={selection.dragEnd} onMouseUp={selection.dragEnd}>
                {[...b.at.values()].sort((x, y) => naturalCompare(x.number, y.number)).map((r) => (
                  <RoomTip key={r.key} room={r}>
                    <Cell room={r} fill={paint(r, layer, variants).fill} selected={selection.sel.has(r.key)} size={48} onDown={() => selection.dragStart(r.key)} onEnter={() => selection.dragOver(r.key)} />
                  </RoomTip>
                ))}
              </Box>
            </Panel>
          ))}
        </Box>
      ) : null}
      {rooms.length && view === 'scheme' ? (
        <Box sx={{ display: 'grid', gap: 1.5 }} onMouseUp={selection.dragEnd} onMouseLeave={selection.dragEnd}>
          {layout(rooms).map((b) => (
            <Chess key={b.building} b={b} layer={layer} variants={variants} selection={selection} hotelName={hotel.name} />
          ))}
        </Box>
      ) : null}
      <Actions count={selection.sel.size} onClear={selection.clear} />
    </Box>
  );
}

function Cell({ room, fill, selected, size, onDown, onEnter, label = true }: { room: MockRoom; fill: string; selected: boolean; size: number; onDown?: () => void; onEnter?: () => void; label?: boolean }) {
  return (
    <Box
      role="button"
      tabIndex={0}
      data-testid={`sandbox-room-${room.number}`}
      onMouseDown={(e) => {
        e.preventDefault();
        onDown?.();
      }}
      onMouseEnter={onEnter}
      sx={{
        width: size,
        height: size * 0.72,
        borderRadius: '6px',
        bgcolor: fill,
        display: 'grid',
        placeItems: 'center',
        fontSize: size >= 40 ? 11.5 : 9,
        fontWeight: 800,
        color: ink.hi,
        cursor: 'pointer',
        userSelect: 'none',
        opacity: room.active ? 1 : 0.45,
        outline: selected ? `2px solid ${accent.main}` : `1px solid ${surface.line}`,
        outlineOffset: selected ? 1 : -1,
        boxShadow: selected ? `0 0 0 3px ${accent.washSoft}` : 'none',
        transition: 'transform .08s',
        '&:hover': { transform: 'translateY(-1px)' },
      }}
    >
      {/* Длинный «номер» (вилла, офис) в клетку не влезает — хвост; целиком — в карточке. */}
      {label ? (room.number.length > 5 ? room.number.split(/[-\s]/).pop() : room.number) : null}
    </Box>
  );
}

/** Шахматка корпуса: этажи сверху вниз, стояки — столбцами; щелчок по подписи выбирает целиком. */
function Chess({ b, layer, variants, selection, hotelName }: { b: BuildingLayout; layer: Layer; variants: string[]; selection: ReturnType<typeof useSelection>; hotelName: string }) {
  const all = [...b.at.values()];
  const floorKeys = (f: string) => all.filter((r) => r.floor === f).map((r) => r.key);
  const stackKeys = (p: string) => all.filter((r) => r.position === p).map((r) => r.key);
  const head = (text: ReactNode, onClick: () => void, testId: string) => (
    <ButtonBase onClick={onClick} data-testid={testId} sx={{ ...typo.caption, fontWeight: 700, color: ink.mid, borderRadius: 1, px: 0.5, '&:hover': { color: accent.soft } }}>
      {text}
    </ButtonBase>
  );
  return (
    <Panel
      title={b.building || hotelName}
      aside={
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Box sx={{ ...typo.caption, color: ink.low }}>{b.floors.length} этажей · {b.positions.length} стояков · {all.length} номеров</Box>
          <Button size="small" sx={secondaryButtonSx} onClick={() => selection.set(all.map((r) => r.key), true)} data-testid="sandbox-select-building">Весь корпус</Button>
          <Help>Строка — этаж, столбец — стояк: номера с одинаковым окончанием друг под другом. Щёлкните подпись этажа или стояка, чтобы выбрать их целиком; протяните мышью по номерам; Shift — диапазон.</Help>
        </Box>
      }
    >
      <Box sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ borderCollapse: 'separate', borderSpacing: '4px' }}>
          <Box component="thead">
            <Box component="tr">
              <Box component="th" />
              {b.positions.map((p) => (
                <Box component="th" key={p} sx={{ p: 0 }}>{head(`…${p}`, () => selection.set(stackKeys(p), true), `sandbox-stack-${p}`)}</Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {b.floors.map((f) => (
              <Box component="tr" key={f}>
                <Box component="td" sx={{ pr: 0.5, whiteSpace: 'nowrap' }}>{head(f ? `${f} эт.` : 'без этажа', () => selection.set(floorKeys(f), true), `sandbox-floor-${f}`)}</Box>
                {b.positions.map((p) => {
                  const room = b.at.get(`${f}|${p}`);
                  return (
                    <Box component="td" key={p} sx={{ p: 0 }}>
                      {room ? (
                        <RoomTip room={room}>
                          <Cell room={room} fill={paint(room, layer, variants).fill} selected={selection.sel.has(room.key)} size={44} onDown={() => selection.dragStart(room.key)} onEnter={() => selection.dragOver(room.key)} />
                        </RoomTip>
                      ) : (
                        <Box sx={{ width: 44, height: 32, borderRadius: '6px', border: `1px dashed ${surface.hair}` }} />
                      )}
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Panel>
  );
}

/* ── Вариант Б: фасад ────────────────────────────────────────────────────── */

function Facade({ hotel, rooms, facets, layer, variants }: ViewProps) {
  const [, go] = useGo();
  const selection = useSelection();
  const [focus, setFocus] = useState<MockRoom | null>(null);
  const buildings = layout(rooms);
  const picked = rooms.filter((r) => selection.sel.has(r.key));
  return (
    <Box>
      <FilterBar facets={facets} placeholder="Номер" />
      <Box sx={{ ...panelSx, p: 1.25, mb: 1.5, display: 'grid', gap: 1 }}>
        <LayerPicker layer={layer} onChange={(l) => go({ layer: l === 'control' ? null : l })} />
        <Legend rooms={rooms} layer={layer} variants={variants} />
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1fr) 320px' }, alignItems: 'start' }}>
        <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 1, alignItems: 'flex-end' }} onMouseUp={selection.dragEnd} onMouseLeave={selection.dragEnd}>
          {buildings.map((b) => (
            <Box key={b.building} sx={{ flex: 'none' }} data-testid={`sandbox-facade-${b.building || 'main'}`}>
              {/* Крыша и подпись корпуса */}
              <Box sx={{ mx: 1, height: 14, borderRadius: '10px 10px 0 0', bgcolor: surface.s3, border: `1px solid ${surface.line}`, borderBottom: 'none' }} />
              <Box sx={{ ...panelSx, p: 1, borderRadius: '6px', display: 'grid', gap: '6px', bgcolor: surface.s2 }}>
                {b.floors.map((f) => (
                  <Box key={f} sx={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <ButtonBase
                      onClick={() => selection.set([...b.at.values()].filter((r) => r.floor === f).map((r) => r.key), true)}
                      sx={{ width: 34, ...typo.caption, fontWeight: 700, color: ink.mid, justifyContent: 'flex-end', pr: 0.5 }}
                    >
                      {f || '—'}
                    </ButtonBase>
                    {b.positions.map((p) => {
                      const room = b.at.get(`${f}|${p}`);
                      return room ? (
                        <Box key={p} onClick={() => setFocus(room)}>
                          <Cell room={room} fill={paint(room, layer, variants).fill} selected={selection.sel.has(room.key)} size={30} label={false} onDown={() => selection.dragStart(room.key)} onEnter={() => selection.dragOver(room.key)} />
                        </Box>
                      ) : (
                        <Box key={p} sx={{ width: 30, height: 22 }} />
                      );
                    })}
                  </Box>
                ))}
                {/* Цоколь: стояки — щелчок выбирает весь столбец */}
                <Box sx={{ display: 'flex', gap: '6px', borderTop: `2px solid ${surface.line}`, pt: 0.5 }}>
                  <Box sx={{ width: 34 }} />
                  {b.positions.map((p) => (
                    <ButtonBase key={p} onClick={() => selection.set([...b.at.values()].filter((r) => r.position === p).map((r) => r.key), true)} sx={{ width: 30, fontSize: 9.5, fontWeight: 700, color: ink.low }}>
                      {p}
                    </ButtonBase>
                  ))}
                </Box>
              </Box>
              <Box sx={{ textAlign: 'center', ...typo.caption, fontWeight: 700, color: ink.hi, mt: 0.75 }}>{b.building || hotel.name}</Box>
            </Box>
          ))}
        </Box>
        <Panel title={picked.length > 1 ? `Выбрано: ${picked.length}` : focus ? `Номер ${focus.number}` : 'Номер'}>
          {picked.length > 1 ? (
            <Box sx={{ display: 'grid', gap: 1, ...typo.caption, color: ink.mid }}>
              <Box>Вариантов среди выбранных: {new Set(picked.map((r) => r.variant ?? '—')).size}; без PIN: {picked.filter((r) => !r.pin).length}.</Box>
              <Actions count={picked.length} onClear={selection.clear} />
            </Box>
          ) : focus ? (
            <Box sx={{ display: 'grid', gap: 0.75, ...typo.caption }}>
              {[
                ['Корпус', focus.building || '—'],
                ['Этаж', `${focus.floor || '—'}${focus.derived ? ' (из номера)' : ''}`],
                ['Стояк', focus.position],
                ['Категория', focus.category || '—'],
                ['Вариант', focus.variant ?? 'не назначен'],
                ['PIN', focus.pin ? 'есть' : 'нет'],
              ].map(([k, val]) => (
                <Box key={k} sx={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${surface.hair}`, py: 0.5 }}>
                  <Box sx={{ color: ink.mid }}>{k}</Box>
                  <Box sx={{ color: ink.hi, fontWeight: 700 }}>{val}</Box>
                </Box>
              ))}
              <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', color: ink.mid }}>
                Занятость: {{ occupied: 'занят', free: 'свободен', cleaning: 'уборка', out: 'не продаётся' }[focus.occupancy]} <Sample />
              </Box>
              <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                <Button size="small" sx={secondaryButtonSx}>Проверить номер</Button>
                <Button size="small" sx={secondaryButtonSx}>Выдать PIN</Button>
              </Box>
            </Box>
          ) : (
            <Empty title="Выберите номер" testId="sandbox-facade-empty">Щёлкните окно на фасаде — здесь появится номер. Протяните мышью или щёлкните подпись этажа или стояка, чтобы выбрать группу.</Empty>
          )}
        </Panel>
      </Box>
    </Box>
  );
}

/* ── Вариант В: сначала проблемы ─────────────────────────────────────────── */

function ProblemsFirst({ hotel, rooms, facets, layer, variants }: ViewProps) {
  const [params, go] = useGo();
  const selection = useSelection();
  const openFloor = params.get('floor');
  const [action, setAction] = useState<null | { title: string; n: number }>(null);
  const total = rooms.length;
  const buckets = [
    { key: 'silent', title: 'Оборудование не отвечает', tone: 'bad' as const, rooms: rooms.filter((r) => r.problems.includes('silent')), fix: 'Проверить связь', help: 'Номер не ответил на последнюю проверку. Чаще всего — пропало питание или сеть в номере.' },
    { key: 'noVariant', title: 'Номер без варианта', tone: 'warn' as const, rooms: rooms.filter((r) => r.problems.includes('noVariant')), fix: 'Назначить вариант', help: 'Гость не увидит управления: номеру не назначена схема.' },
    { key: 'noPin', title: 'Нет PIN', tone: 'info' as const, rooms: rooms.filter((r) => r.problems.includes('noPin')), fix: 'Выдать PIN', help: 'Гость не сможет войти в управление номером без PIN (если вход по PIN включён).' },
  ];
  const ready = rooms.filter((r) => !r.problems.length).length;
  const buildings = layout(rooms);
  return (
    <Box>
      <FilterBar facets={facets} placeholder="Номер" />
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1.1fr 1fr' }, mb: 1.5 }}>
        <Panel title="Готовность управления номером" aside={<Help>Доля номеров, где гость уже сейчас может управлять светом и климатом.</Help>}>
          <Box sx={{ ...typo.metric, color: ink.hi }}>{total ? Math.round((ready / total) * 100) : 0}%</Box>
          <Box sx={{ ...typo.caption, color: ink.mid, mb: 1 }}>{ready} из {total} номеров готовы</Box>
          <Box sx={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', bgcolor: surface.s3 }}>
            {[
              { n: ready, c: state.ok },
              { n: buckets[1].rooms.length, c: state.warn },
              { n: buckets[2].rooms.length, c: state.info },
              { n: buckets[0].rooms.length, c: state.bad },
            ].map((s, i) => (
              <Box key={i} sx={{ width: `${total ? (s.n / total) * 100 : 0}%`, bgcolor: s.c }} />
            ))}
          </Box>
        </Panel>
        <Panel title="Что исправить" aside={<Box sx={{ ...typo.caption, color: ink.low }}>по важности</Box>}>
          <Box sx={{ display: 'grid', gap: 1 }}>
            {buckets.map((b) => (
              <Box key={b.key} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }} data-testid={`sandbox-bucket-${b.key}`}>
                <Pill tone={b.tone}>{b.rooms.length}</Pill>
                <Box sx={{ ...typo.body, color: ink.hi, flex: 1, minWidth: 160 }}>
                  {b.title} {b.key === 'silent' ? <Sample /> : null}
                  <Help>{b.help}</Help>
                </Box>
                <Button size="small" sx={secondaryButtonSx} disabled={!b.rooms.length} onClick={() => setAction({ title: `${b.fix} — ${b.rooms.length} номерам`, n: b.rooms.length })}>
                  {b.fix}…
                </Button>
              </Box>
            ))}
          </Box>
        </Panel>
      </Box>
      <Box sx={{ ...panelSx, p: 1.25, mb: 1.5, display: 'grid', gap: 1 }}>
        <LayerPicker layer={layer} onChange={(l) => go({ layer: l === 'control' ? null : l })} />
        <Legend rooms={rooms} layer={layer} variants={variants} />
      </Box>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: `repeat(${Math.min(buildings.length, 3)}, minmax(0,1fr))` } }}>
        {buildings.map((b) => (
          <Panel key={b.building} title={b.building || hotel.name} aside={<Box sx={{ ...typo.caption, color: ink.low }}>щёлкните этаж</Box>}>
            <Box sx={{ display: 'grid', gap: '3px' }}>
              {b.floors.map((f) => {
                const list = [...b.at.values()].filter((r) => r.floor === f).sort((x, y) => naturalCompare(x.number, y.number));
                const open = openFloor === `${b.building}|${f}`;
                return (
                  <Box key={f}>
                    <ButtonBase
                      onClick={() => go({ floor: open ? null : `${b.building}|${f}` })}
                      data-testid={`sandbox-heat-${b.building || 'main'}-${f}`}
                      sx={{ display: 'flex', gap: '3px', alignItems: 'center', width: '100%', justifyContent: 'flex-start', borderRadius: 1, p: '2px', bgcolor: open ? accent.washSoft : 'transparent' }}
                    >
                      <Box sx={{ width: 28, ...typo.caption, fontWeight: 700, color: ink.mid, textAlign: 'right', pr: 0.5 }}>{f || '—'}</Box>
                      {list.map((r) => (
                        <Box key={r.key} sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: paint(r, layer, variants).fill }} />
                      ))}
                    </ButtonBase>
                    {open ? (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, p: 1, mt: 0.5, borderRadius: 1, border: `1px solid ${surface.line}` }}>
                        {list.map((r) => (
                          <RoomTip key={r.key} room={r}>
                            <Box onClick={() => selection.toggle(r.key, list.map((x) => x.key), false)}>
                              <Cell room={r} fill={paint(r, layer, variants).fill} selected={selection.sel.has(r.key)} size={46} />
                            </Box>
                          </RoomTip>
                        ))}
                        <Button size="small" sx={secondaryButtonSx} onClick={() => selection.set(list.map((r) => r.key), true)}>Весь этаж</Button>
                      </Box>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          </Panel>
        ))}
      </Box>
      <Actions count={selection.sel.size} onClear={selection.clear} />
      {action ? (
        <MockAction title={action.title} onClose={() => setAction(null)}>
          <Box>Действие применится ко всем {action.n} номерам из этой строки. Перед применением будет показан список.</Box>
        </MockAction>
      ) : null}
    </Box>
  );
}

