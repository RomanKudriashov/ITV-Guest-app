import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import FitScreenOutlinedIcon from '@mui/icons-material/FitScreenOutlined';
import TableRowsOutlinedIcon from '@mui/icons-material/TableRowsOutlined';
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';
import { accent, fieldSx, ink, panelSx, primaryButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../../adminTokens';
import { getRoomsDictionaries, getRoomsMap, putRoomRule, type DictKind, type MapRoom, type RoomRule, type RoomsMap } from '../../adminClient';
import { AdminDialog } from '../../form';
import { useRights } from '../../useRights';
import { Empty, FilterBar, Help, Hl, Panel, Pill, ViewSwitch, type Facet } from '../hotels/hotelsUi';
import { SortBar, SortHeader, useSort, type SortState } from '../../sort';
import {
  BuildingScheme,
  CursorCard,
  LAYERS,
  Legend,
  PROBLEM_ORDER,
  TILES,
  ZOOM_MAX,
  ZOOM_MIN,
  highlightSx,
  useCursorCard,
  useSwatches,
  type Layer,
  type Swatches,
  type Tile,
} from './roomsMap';
import { AddRoomsDialog, DictionaryDialog, RoomDialog } from './roomDialogs';
import { BatchDialog, SelectionPanel, useMarquee, type Group } from './roomBatch';

/**
 * НОМЕРНОЙ ФОНД (партия 63-1, вариант А макетов 63-М, с правкой).
 *
 * Виды Схема (по умолчанию) · Таблица; в схеме — плитка на выбор («Полоса»,
 * «Карточка» по умолчанию, «Шахматка»): выбор в адресе и запоминается для
 * этого браузера. Слой цветом с легендой, «Что исправить» сверху, поиск и
 * фильтры чипами — всё в адресе. Номер открывается окном (`room=` в адресе),
 * номера добавляются кнопкой над схемой, «+» в конце этажа и у пустого
 * отеля. Правка — через те же сервисы, что у панели отеля.
 */

const FACET_KEYS = ['building', 'floor', 'category', 'variant', 'connection', 'pin', 'control', 'problem'] as const;
const SORT_KEYS = ['number', 'building', 'floor', 'position', 'category', 'variant', 'connection', 'pin', 'control'] as const;
type View = 'table' | 'scheme';
const TILE_KEY = 'itv.admin.rooms.tile';

function storedTile(): Tile | null {
  try {
    const value = window.localStorage.getItem(TILE_KEY);
    return TILES.includes(value as Tile) ? (value as Tile) : null;
  } catch {
    return null;
  }
}

function rememberTile(tile: Tile) {
  try {
    window.localStorage.setItem(TILE_KEY, tile);
  } catch {
    /* хранилище недоступно — выбор живёт только в адресе */
  }
}

export function RoomsTab({ hotelId }: { hotelId: string }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const sort = useSort('', [...SORT_KEYS]);
  const query: Record<string, string> = {
    ...Object.fromEntries(['search', ...FACET_KEYS].map((k) => [k, params.get(k) ?? ''])),
    ...sort.query,
  };
  const map = useQuery({
    queryKey: ['admin', 'hotel-rooms-map', hotelId, query],
    queryFn: () => getRoomsMap(hotelId, query),
    placeholderData: keepPreviousData,
  });
  return (
    <Box data-testid="admin-rooms">
      <QueryState query={map} what={t('admin.card.rooms.what')}>
        {(data) => <Rooms hotelId={hotelId} data={data} search={query.search} sort={sort} />}
      </QueryState>
    </Box>
  );
}

function useParam() {
  const [params, setParams] = useSearchParams();
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === '') next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  return [params, set] as const;
}

function Rooms({ hotelId, data, search, sort }: { hotelId: string; data: RoomsMap; search: string; sort: SortState }) {
  const { t } = useTranslation();
  const { canWrite } = useRights();
  const [params, set] = useParam();
  const narrow = useMediaQuery('(max-width:899px)');
  // «Блоки» убраны (63-1): старый адрес `view=blocks` открывает схему.
  const view: View = params.get('view') === 'table' ? 'table' : 'scheme';
  const tile: Tile = (TILES.includes(params.get('tile') as Tile) ? (params.get('tile') as Tile) : null) ?? storedTile() ?? 'b';
  const layer: Layer = LAYERS.includes(params.get('layer') as Layer) ? (params.get('layer') as Layer) : 'control';
  const zoom = Math.min(Math.max(Number(params.get('zoom')) || 0, ZOOM_MIN), ZOOM_MAX);
  /*
    Масштаб шагом от ПОСЛЕДНЕГО записанного значения, а не от отрисованного:
    `setSearchParams` в react-router 6 отдаёт функции параметры прошлой
    отрисовки, и два быстрых «+» давали «1» вместо «2» (поймал e2e 63-1).
  */
  const zoomRef = useRef(zoom);
  const seen = useRef(zoom);
  if (seen.current !== zoom) {
    seen.current = zoom;
    zoomRef.current = zoom;
  }
  const step = (delta: number | null) => {
    const value = delta === null ? 0 : Math.min(Math.max(zoomRef.current + delta, ZOOM_MIN), ZOOM_MAX);
    zoomRef.current = value;
    set({ zoom: value ? String(value) : null });
  };
  const [highlight, setHighlight] = useState<string | null>(null);
  const [adding, setAdding] = useState<null | { building_id?: string; floor?: string }>(null);
  const [dictKind, setDictKind] = useState<DictKind | null>(null);
  const [toast, setToast] = useState('');
  /*
    ВЫБОР НОМЕРОВ (63-2) — в памяти экрана, не в адресе: ссылка с выбором
    открыла бы чужому те же «выбранные» и выполнила бы не то, что он видит.
  */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [batch, setBatch] = useState<Group | null>(null);
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const toggle = (ids: string[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const all = ids.length > 0 && ids.every((id) => next.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  const clearSelection = () => {
    setSelected(new Set());
    setSelectMode(false);
  };
  const marquee = useMarquee(
    useCallback((ids: string[], add: boolean) => {
      setSelected((prev) => (add ? new Set([...prev, ...ids]) : new Set(ids)));
    }, []),
  );
  const dict = useQuery({ queryKey: ['admin', 'rooms-dictionaries', hotelId], queryFn: () => getRoomsDictionaries(hotelId) });

  const rooms = useMemo(() => data.buildings.flatMap((b) => b.floors.flatMap((f) => f.rooms)), [data]);
  const byId = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const swatches = useSwatches(rooms);
  const card = useCursorCard(byId, !narrow);
  const openId = params.get('room');
  // ← и → в окне номера идут в порядке экрана: в схеме — корпус, этаж, позиция;
  // в таблице — порядок выбранной сортировки.
  const order = view === 'table' ? data.order : rooms.map((r) => r.id);

  const facets: Facet[] = FACET_KEYS.map((key) => ({
    key,
    label: t(`admin.card.rooms.facet.${key}`),
    options: data.facets[key].map((o) => ({ value: o.value, label: facetLabel(t, key, o.value, o.label), count: o.count })),
    describe: (value: string) => facetLabel(t, key, value, value),
  }));

  const openRoom = (event: React.MouseEvent | React.KeyboardEvent) => {
    if ('key' in event && event.key !== 'Enter' && event.key !== ' ') return;
    if ((event.target as HTMLElement).closest('[role="checkbox"], input[type="checkbox"]')) return;
    // Долгое нажатие уже выбрало номер — щелчок после него не открывает окно.
    if (press.current?.fired) {
      press.current = null;
      return;
    }
    const target = (event.target as HTMLElement).closest('[data-room-id]') as HTMLElement | null;
    const room = target ? byId.get(target.dataset.roomId ?? '') : undefined;
    if (!room) return;
    // Shift, Cmd или Ctrl — добавить к выбору; в режиме выбора — касание выбирает.
    if (event.shiftKey || event.metaKey || event.ctrlKey || selectMode) {
      event.preventDefault();
      toggle([room.id]);
      return;
    }
    card.clear();
    set({ room: room.id });
  };
  /** На телефоне выбор включается долгим нажатием на номер. */
  const onPointerDown = (event: React.PointerEvent) => {
    marquee.onPointerDown(event);
    if (event.pointerType === 'mouse') return;
    const target = (event.target as HTMLElement).closest('[data-room-id]') as HTMLElement | null;
    const id = target?.dataset.roomId;
    if (!id) return;
    const timer = window.setTimeout(() => {
      if (!press.current) return;
      press.current.fired = true;
      setSelectMode(true);
      setSelected((prev) => new Set(prev).add(id));
    }, 500);
    press.current = { timer, x: event.clientX, y: event.clientY, fired: false };
  };
  const cancelPress = (event: React.PointerEvent) => {
    const p = press.current;
    if (!p || p.fired) return;
    if (event.type === 'pointermove' && Math.hypot(event.clientX - p.x, event.clientY - p.y) < 10) return;
    window.clearTimeout(p.timer);
    press.current = null;
  };
  const shownIds = rooms.map((r) => r.id);
  const addDone = (created?: number) => {
    setAdding(null);
    if (created) setToast(t('admin.card.rooms.add.done', { count: created }));
  };

  const dialogs = (
    <>
      {openId ? (
        <RoomDialog
          hotelId={hotelId}
          roomId={openId}
          order={order}
          dict={dict.data}
          canWrite={canWrite}
          onNavigate={(id) => set({ room: id })}
          onClose={() => set({ room: null })}
          onOpenTab={(tab) => set({ room: null, tab })}
        />
      ) : null}
      {adding ? <AddRoomsDialog hotelId={hotelId} dict={dict.data} initial={adding} onClose={addDone} /> : null}
      {dictKind ? <DictionaryDialog hotelId={hotelId} kind={dictKind} dict={dict.data} canWrite={canWrite} onClose={() => setDictKind(null)} /> : null}
    </>
  );

  if (!data.total) {
    return (
      <Panel title={t('admin.card.rooms.title')}>
        <Empty
          title={t('admin.card.rooms.emptyTitle')}
          testId="admin-rooms-empty"
          action={
            canWrite ? (
              <Button sx={{ ...primaryButtonSx, px: 3, py: 1.25, fontSize: 15 }} startIcon={<AddIcon />} onClick={() => setAdding({})} data-testid="admin-rooms-add-first">
                {t('admin.card.rooms.add.first')}
              </Button>
            ) : undefined
          }
        >
          {t('admin.card.rooms.emptyBody')}
          {canWrite ? <Box sx={{ mt: 1, color: ink.low }}>{t('admin.card.rooms.add.firstExample')}</Box> : null}
        </Empty>
        {dialogs}
      </Panel>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: 1.5, minWidth: 0 }}>
      <FixPanel data={data} />
      <RuleStrip hotelId={hotelId} data={data} sample={rooms[0]?.number ?? '2205'} />
      <Box sx={{ ...panelSx, p: { xs: 1.25, md: 2 }, minWidth: 0 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }} data-testid="admin-rooms-toolbar">
          {canWrite ? (
            <Button sx={primaryButtonSx} startIcon={<AddIcon />} onClick={() => setAdding({})} data-testid="admin-rooms-add">
              {t('admin.card.rooms.add.button')}
            </Button>
          ) : null}
          <Button sx={secondaryButtonSx} onClick={() => setDictKind('building')} data-testid="admin-rooms-buildings">
            {canWrite ? t('admin.card.rooms.dict.building.open') : t('admin.card.rooms.dict.building.title')}
          </Button>
          <Button sx={secondaryButtonSx} onClick={() => setDictKind('category')} data-testid="admin-rooms-categories">
            {t('admin.card.rooms.dict.category.title')}
          </Button>
          <Button sx={secondaryButtonSx} onClick={() => setSelected((prev) => new Set([...prev, ...shownIds]))} data-testid="admin-rooms-select-shown" title={t('admin.card.rooms.sel.shownHelp')}>
            {t('admin.card.rooms.sel.shown', { count: shownIds.length })}
          </Button>
          {toast ? (
            <Box sx={{ ...typo.caption, color: state.ok, alignSelf: 'center' }} data-testid="admin-rooms-toast">
              {toast}
            </Box>
          ) : null}
        </Box>
        <FilterBar
          facets={facets}
          placeholder={t('admin.card.rooms.search')}
          aside={
            <ViewSwitch<View>
              label={t('admin.card.rooms.view.label')}
              value={view}
              testIdPrefix="admin-rooms-view"
              onChange={(next) => set({ view: next === 'scheme' ? null : next })}
              options={[
                ['scheme', t('admin.card.rooms.view.scheme'), <ApartmentOutlinedIcon key="s" fontSize="small" />],
                ['table', t('admin.card.rooms.view.table'), <TableRowsOutlinedIcon key="t" fontSize="small" />],
              ]}
            />
          }
        />
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
          <LayerPicker layer={layer} onChange={(next) => set({ layer: next === 'control' ? null : next })} />
          <Box sx={{ flex: 1 }} />
          {view === 'scheme' ? (
            <>
              <ViewSwitch<Tile>
                label={t('admin.card.rooms.tile.label')}
                value={tile}
                testIdPrefix="admin-rooms-tile"
                onChange={(next) => {
                  rememberTile(next);
                  set({ tile: next });
                }}
                options={TILES.map((key) => [key, t(`admin.card.rooms.tile.${key}`)] as [Tile, string])}
              />
              <ZoomBar zoom={zoom} onStep={step} />
            </>
          ) : null}
        </Box>
        <Box sx={{ mb: 1.5 }}>
          <Legend rooms={rooms} layer={layer} swatches={swatches} highlight={highlight} onHighlight={setHighlight} />
          {!narrow ? <Typography sx={{ ...typo.caption, color: ink.low, mt: 0.5 }}>{t('admin.card.rooms.legend.hint')}</Typography> : null}
        </Box>
        <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1 }} data-testid="admin-rooms-count">
          {t('admin.card.rooms.count', { found: data.found, total: data.total })}
        </Typography>
        {!data.found ? (
          <Empty title={t('admin.card.rooms.noMatch')} testId="admin-rooms-nomatch">{t('admin.card.rooms.noMatchBody')}</Empty>
        ) : (
          <Box
            sx={{ display: 'grid', gap: 2.5, minWidth: 0, userSelect: marquee.dragging ? 'none' : undefined, ...highlightSx(highlight) }}
            {...card.handlers}
            onClick={openRoom}
            onKeyDown={openRoom}
            onPointerDown={onPointerDown}
            onPointerUp={cancelPress}
            onPointerCancel={cancelPress}
            onPointerMove={cancelPress}
            onContextMenu={(e) => press.current && e.preventDefault()}
            data-testid="admin-rooms-body"
            data-select-mode={selectMode ? 'true' : undefined}
          >
            {view === 'table' ? (
              <RoomsTable data={data} byId={byId} search={search} sort={sort} narrow={narrow} layer={layer} swatches={swatches} selected={selected} onToggle={toggle} />
            ) : (
              data.buildings.map((building) => (
                <Box key={building.key || 'none'} sx={{ minWidth: 0 }} data-testid={`admin-rooms-building-${building.key || 'none'}`}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                    <Typography component="h3" sx={{ ...typo.panelTitle, color: ink.hi }}>
                      {building.title ? <span data-words="data">{building.title}</span> : t('admin.card.rooms.noBuilding')}
                    </Typography>
                    <Box sx={{ ...typo.caption, color: ink.low }}>{t('admin.card.rooms.roomsCount', { count: building.rooms })}</Box>
                    <ButtonBase
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(building.floors.flatMap((f) => f.rooms.map((r) => r.id)));
                      }}
                      sx={{ ...typo.caption, color: accent.soft, fontWeight: 700, px: 0.5, borderRadius: 1 }}
                      data-testid={`admin-rooms-select-building-${building.key || 'none'}`}
                    >
                      {t('admin.card.rooms.sel.building')}
                    </ButtonBase>
                    {canWrite && building.key && !building.key.startsWith('zone:') ? (
                      <ButtonBase
                        onClick={(e) => {
                          e.stopPropagation();
                          setDictKind('building');
                        }}
                        sx={{ ...typo.caption, color: accent.soft, fontWeight: 700, px: 0.5, borderRadius: 1 }}
                        data-testid={`admin-rooms-building-rename-${building.key}`}
                      >
                        {t('admin.card.rooms.dict.building.rename')}
                      </ButtonBase>
                    ) : null}
                  </Box>
                  <BuildingScheme
                    building={building}
                    layer={layer}
                    swatches={swatches}
                    tile={tile}
                    zoom={zoom}
                    selected={selected}
                    onSelect={toggle}
                    onAdd={
                      canWrite
                        ? (floor) => setAdding({ floor, building_id: building.key && !building.key.startsWith('zone:') ? building.key : undefined })
                        : undefined
                    }
                  />
                </Box>
              ))
            )}
          </Box>
        )}
      </Box>
      {marquee.overlay}
      {selectMode ? (
        <Typography sx={{ ...typo.caption, color: accent.soft }} data-testid="admin-rooms-select-mode">{t('admin.card.rooms.sel.modeHint')}</Typography>
      ) : null}
      <SelectionPanel count={selected.size} canWrite={canWrite} onAction={setBatch} onClear={clearSelection} />
      {batch ? (
        <BatchDialog hotelId={hotelId} group={batch} roomIds={[...selected]} dict={dict.data} onClose={() => setBatch(null)} onDone={clearSelection} />
      ) : null}
      <CursorCard hover={card.hover}>{card.hover ? <RoomFacts room={card.hover.room} swatches={swatches} /> : null}</CursorCard>
      {dialogs}
    </Box>
  );
}

function facetLabel(t: (k: string, o?: Record<string, unknown>) => string, key: string, value: string, fallback: string) {
  if (value === 'none') {
    if (key === 'building') return t('admin.card.rooms.noBuilding');
    if (key === 'floor') return t('admin.card.rooms.noFloor');
    if (key === 'variant') return t('admin.card.rooms.noVariantValue');
    if (key === 'connection') return t('admin.card.rooms.noConnection');
    return t('admin.card.rooms.none');
  }
  if (key === 'pin') return t(`admin.card.rooms.pinValue.${value}`, { defaultValue: t('admin.hotels.filter.unknownValue') });
  if (key === 'control') return t(`admin.card.rooms.control.${value}`, { defaultValue: t('admin.hotels.filter.unknownValue') });
  if (key === 'problem') return t(`admin.card.rooms.problem.${value}`, { defaultValue: t('admin.hotels.filter.unknownValue') });
  if (key === 'floor') return t('admin.card.rooms.floorLong', { floor: fallback });
  return fallback;
}

/* ── «Что исправить» ────────────────────────────────────────────────────── */

function FixPanel({ data }: { data: RoomsMap }) {
  const { t } = useTranslation();
  const [params, set] = useParam();
  const active = (params.get('problem') ?? '').split(',').filter(Boolean);
  const lines = PROBLEM_ORDER.filter((code) => data.summary.problems[code] > 0);
  return (
    <Panel title={t('admin.card.rooms.fix.title')} aside={<Help>{t('admin.card.rooms.fix.help')}</Help>}>
      <Box data-testid="admin-rooms-fix" sx={{ display: 'grid', gap: 0.75 }}>
        {!data.room_control ? (
          <Typography sx={{ ...typo.body, color: ink.mid }} data-testid="admin-rooms-fix-off">{t('admin.card.rooms.fix.moduleOff')}</Typography>
        ) : !lines.length ? (
          <Typography sx={{ ...typo.body, color: ink.mid }} data-testid="admin-rooms-fix-ok">{t('admin.card.rooms.fix.allGood')}</Typography>
        ) : (
          lines.map((code) => {
            const shown = active.length === 1 && active[0] === code;
            return (
              <Box key={code} sx={{ display: 'flex', gap: 1, alignItems: 'center' }} data-testid={`admin-rooms-fix-${code}`}>
                <Pill tone={code === 'demo_entry' || code === 'not_published' ? 'warn' : 'bad'}>{data.summary.problems[code]}</Pill>
                <Box sx={{ ...typo.body, color: ink.hi, flex: 1, minWidth: 0 }}>{t(`admin.card.rooms.problem.${code}`)}</Box>
                <Button
                  size="small"
                  sx={shown ? primaryButtonSx : secondaryButtonSx}
                  onClick={() => set(shown ? { problem: null } : { problem: code, layer: 'problems' })}
                  data-testid={`admin-rooms-fix-show-${code}`}
                  aria-pressed={shown}
                >
                  {shown ? t('admin.card.rooms.fix.shown') : t('admin.card.rooms.fix.show')}
                </Button>
              </Box>
            );
          })
        )}
      </Box>
    </Panel>
  );
}

/* ── Правило «как читать номер» ─────────────────────────────────────────── */

/** То же правило, что на сервере (`room_numbers.read_number`) — для примера в окне. */
export function readNumber(number: string, rule: { floor_digits: number; position_digits: number }): [string, string] {
  const match = /^\D*?(\d+)(.*)$/.exec(number.trim());
  if (!match) return ['', ''];
  const [, digits, rest] = match;
  const tail = rest.trim();
  if (digits.length <= rule.position_digits) return ['', digits + tail];
  let head = digits.slice(0, -rule.position_digits);
  if (rule.floor_digits) head = head.slice(0, rule.floor_digits);
  return [head.replace(/^0+/, '') || '0', digits.slice(-rule.position_digits) + tail];
}

function ruleText(t: (k: string, o?: Record<string, unknown>) => string, rule: { floor_digits: number; position_digits: number }) {
  return t('admin.card.rooms.rule.text', {
    position: t('admin.card.rooms.rule.lastDigits', { n: rule.position_digits }),
    floor: rule.floor_digits ? t('admin.card.rooms.rule.floorFirst', { n: rule.floor_digits }) : t('admin.card.rooms.rule.floorAll'),
  });
}

/**
 * Сводка правила словами (63-1, замечание Олега): не «прочитан из номера у 0»,
 * а «этажи и позиции у всех номеров — по правилу» или «у 12 номеров позиция
 * задана вручную».
 */
function ruleStats(t: (k: string, o?: Record<string, unknown>) => string, data: RoomsMap) {
  const total = data.total;
  const floors = data.summary.rule_floors;
  const manual = data.summary.manual_positions;
  if (floors === total && !manual) return t('admin.card.rooms.rule.allByRule');
  const floorPart = floors === total ? t('admin.card.rooms.rule.floorsAllRule') : floors === 0 ? t('admin.card.rooms.rule.floorsAllRoom') : t('admin.card.rooms.rule.floorsSomeRule', { count: floors });
  const positionPart = manual ? t('admin.card.rooms.rule.positionsManual', { count: manual }) : t('admin.card.rooms.rule.positionsRule');
  return `${floorPart} ${positionPart}`;
}

function RuleStrip({ hotelId, data, sample }: { hotelId: string; data: RoomsMap; sample: string }) {
  const { t } = useTranslation();
  const { canWrite } = useRights();
  const [editing, setEditing] = useState(false);
  return (
    <Box sx={{ ...panelSx, p: { xs: 1.25, md: 1.5 }, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }} data-testid="admin-rooms-rule">
      <Box sx={{ ...typo.label, color: ink.mid }}>{t('admin.card.rooms.rule.title')}</Box>
      <Help>{t('admin.card.rooms.rule.help')}</Help>
      <Box sx={{ ...typo.body, color: ink.hi, flex: '1 1 320px' }}>
        {ruleText(t, data.rule)}
        {data.rule.is_default ? <Box component="span" sx={{ color: ink.low }}> ({t('admin.card.rooms.rule.byDefault')})</Box> : null}
        <Box component="span" sx={{ ...typo.caption, color: ink.mid, display: 'block' }} data-testid="admin-rooms-rule-stats">
          {ruleStats(t, data)}
        </Box>
      </Box>
      {canWrite ? (
        <Button size="small" sx={secondaryButtonSx} onClick={() => setEditing(true)} data-testid="admin-rooms-rule-edit">
          {t('admin.card.rooms.rule.edit')}
        </Button>
      ) : null}
      {editing ? <RuleDialog hotelId={hotelId} rule={data.rule} sample={sample} onClose={() => setEditing(false)} /> : null}
    </Box>
  );
}

function RuleDialog({ hotelId, rule, sample, onClose }: { hotelId: string; rule: RoomRule; sample: string; onClose: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [draft, setDraft] = useState({ floor_digits: rule.floor_digits, position_digits: rule.position_digits });
  const save = useMutation({
    mutationFn: () => putRoomRule(hotelId, draft),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin', 'hotel-rooms-map', hotelId] });
      onClose();
    },
  });
  const [floor, position] = readNumber(sample, draft);
  return (
    <AdminDialog
      title={t('admin.card.rooms.rule.dialogTitle')}
      onClose={onClose}
      testId="admin-rooms-rule-dialog"
      maxWidth="xs"
      actions={
        <>
          <Button sx={secondaryButtonSx} onClick={onClose}>{t('admin.card.rooms.rule.cancel')}</Button>
          <Button sx={primaryButtonSx} onClick={() => save.mutate()} disabled={save.isPending} data-testid="admin-rooms-rule-save">
            {t('admin.card.rooms.rule.save')}
          </Button>
        </>
      }
    >
      <Box sx={{ display: 'grid', gap: 2, pt: 1 }}>
        <Typography sx={{ ...typo.caption, color: ink.mid }}>{t('admin.card.rooms.rule.help')}</Typography>
        <TextField
          select
          size="small"
          label={t('admin.card.rooms.rule.position')}
          value={draft.position_digits}
          onChange={(e) => setDraft({ ...draft, position_digits: Number(e.target.value) })}
          sx={fieldSx}
          data-testid="admin-rooms-rule-position"
        >
          {[1, 2, 3].map((n) => <MenuItem key={n} value={n}>{t('admin.card.rooms.rule.digits', { n })}</MenuItem>)}
        </TextField>
        <TextField
          select
          size="small"
          label={t('admin.card.rooms.rule.floor')}
          value={draft.floor_digits}
          onChange={(e) => setDraft({ ...draft, floor_digits: Number(e.target.value) })}
          sx={fieldSx}
          data-testid="admin-rooms-rule-floor"
        >
          <MenuItem value={0}>{t('admin.card.rooms.rule.floorAllOption')}</MenuItem>
          {[1, 2, 3].map((n) => <MenuItem key={n} value={n}>{t('admin.card.rooms.rule.floorFirstOption', { n })}</MenuItem>)}
        </TextField>
        <Box sx={{ p: 1.25, borderRadius: `${shape.radiusSmall}px`, bgcolor: surface.s2, ...typo.body, color: ink.hi }} data-testid="admin-rooms-rule-example">
          {floor
            ? t('admin.card.rooms.rule.example', { number: sample, floor, position })
            : t('admin.card.rooms.rule.exampleNoFloor', { number: sample, position })}
        </Box>
        {save.isError ? <Typography sx={{ ...typo.caption, color: state.bad }}>{(save.error as Error).message}</Typography> : null}
      </Box>
    </AdminDialog>
  );
}

/* ── Слой, масштаб ──────────────────────────────────────────────────────── */

function LayerPicker({ layer, onChange }: { layer: Layer; onChange: (l: Layer) => void }) {
  const { t } = useTranslation();
  const chip = (key: string, label: ReactNode, on: boolean, disabled = false, onClick?: () => void) => (
    <ButtonBase
      key={key}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      data-testid={`admin-rooms-layer-${key}`}
      sx={{
        gap: 0.5,
        px: 1.25,
        py: 0.5,
        borderRadius: `${shape.pill}px`,
        ...typo.caption,
        fontWeight: 700,
        border: `1px solid ${on ? accent.main : surface.line}`,
        color: disabled ? ink.low : on ? accent.soft : ink.mid,
        bgcolor: on ? accent.washSoft : 'transparent',
      }}
    >
      {label}
    </ButtonBase>
  );
  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }} role="group" aria-label={t('admin.card.rooms.layer.label')}>
      <Box sx={{ ...typo.label, color: ink.mid, mr: 0.25 }}>{t('admin.card.rooms.layer.label')}</Box>
      {LAYERS.map((key) => chip(key, t(`admin.card.rooms.layer.${key}`), layer === key, false, () => onChange(key)))}
      {chip(
        'occupancy',
        <>
          {t('admin.card.rooms.layer.occupancy')}
          <Pill tone="muted">{t('admin.card.rooms.layer.soon')}</Pill>
        </>,
        false,
        true,
      )}
      <Help>
        <Box sx={{ display: 'grid', gap: 0.75 }}>
          {[...LAYERS, 'occupancy'].map((key) => (
            <Box key={key}>
              <b>{t(`admin.card.rooms.layer.${key}`)}.</b> {t(`admin.card.rooms.layer.help.${key}`)}
            </Box>
          ))}
        </Box>
      </Help>
    </Box>
  );
}

function ZoomBar({ zoom, onStep }: { zoom: number; onStep: (delta: number | null) => void }) {
  const { t } = useTranslation();
  const button = (label: string, icon: ReactNode, onClick: () => void, disabled: boolean, testId: string) => (
    <IconButton size="small" aria-label={label} title={label} onClick={onClick} disabled={disabled} data-testid={testId} sx={{ border: `1px solid ${surface.line}`, borderRadius: `${shape.radiusSmall}px` }}>
      {icon}
    </IconButton>
  );
  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }} role="group" aria-label={t('admin.card.rooms.zoom.label')} data-testid="admin-rooms-zoom">
      {button(t('admin.card.rooms.zoom.out'), <RemoveIcon fontSize="small" />, () => onStep(-1), zoom <= ZOOM_MIN, 'admin-rooms-zoom-out')}
      {button(t('admin.card.rooms.zoom.in'), <AddIcon fontSize="small" />, () => onStep(1), zoom >= ZOOM_MAX, 'admin-rooms-zoom-in')}
      <Button size="small" sx={{ ...secondaryButtonSx, gap: 0.5 }} onClick={() => onStep(null)} disabled={zoom === 0} data-testid="admin-rooms-zoom-fit">
        <FitScreenOutlinedIcon fontSize="small" />
        {zoom === 0 ? t('admin.card.rooms.zoom.fitted') : t('admin.card.rooms.zoom.fit')}
      </Button>
    </Box>
  );
}

/* ── Таблица ────────────────────────────────────────────────────────────── */

function Dot({ room, layer, swatches }: { room: MapRoom; layer: Layer; swatches: Swatches }) {
  const s = swatches.swatchOf(room, layer);
  return (
    <Box
      component="span"
      aria-hidden
      data-v={s.value}
      sx={{ width: 18, height: 18, flex: 'none', borderRadius: '5px', display: 'inline-grid', placeItems: 'center', fontSize: 11, fontWeight: 800, color: ink.hi, border: `1px solid ${s.base}`, bgcolor: `color-mix(in srgb, ${s.base} 22%, transparent)` }}
    >
      {s.glyph}
    </Box>
  );
}

function RoomsTable({
  data,
  byId,
  search,
  sort,
  narrow,
  layer,
  swatches,
  selected,
  onToggle,
}: {
  data: RoomsMap;
  byId: Map<string, MapRoom>;
  search: string;
  sort: SortState;
  narrow: boolean;
  layer: Layer;
  swatches: Swatches;
  selected: Set<string>;
  onToggle: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const rows = data.order.map((id) => byId.get(id)).filter(Boolean) as MapRoom[];
  const allIds = rows.map((r) => r.id);
  const allOn = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const box = (room: MapRoom) => (
    <Checkbox
      size="small"
      checked={selected.has(room.id)}
      onClick={(e) => e.stopPropagation()}
      onChange={() => onToggle([room.id])}
      inputProps={{ 'aria-label': t('admin.card.rooms.sel.one', { number: room.number }), 'data-testid': `admin-room-check-${room.number}` } as never}
      sx={{ p: 0.5 }}
    />
  );
  const columns = SORT_KEYS.map((key) => ({ key, label: t(`admin.card.rooms.col.${key}`) }));
  if (narrow) {
    return (
      <Box sx={{ display: 'grid', gap: 1 }}>
        <SortBar columns={columns} state={sort} testId="admin-rooms-sort" />
        <Box sx={{ display: 'flex', alignItems: 'center', ...typo.caption, color: ink.mid }}>
          <Checkbox size="small" checked={allOn} onChange={() => onToggle(allIds)} inputProps={{ 'aria-label': t('admin.card.rooms.sel.allShown'), 'data-testid': 'admin-rooms-check-all' } as never} />
          {t('admin.card.rooms.sel.allShown')}
        </Box>
        {rows.map((room) => (
          <Box key={room.id} role="button" tabIndex={0} data-room-id={room.id} data-testid={`admin-room-${room.number}`} data-selected={selected.has(room.id) ? 'true' : undefined} sx={{ ...panelSx, p: 1.25, display: 'flex', gap: 1, alignItems: 'center', cursor: 'pointer', outline: selected.has(room.id) ? `2px solid ${accent.main}` : 'none' }}>
            {box(room)}
            <Dot room={room} layer={layer} swatches={swatches} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>
                <Hl text={room.number} q={search} />
              </Box>
              <Box sx={{ ...typo.caption, color: ink.mid }}>
                {[room.building, room.floor && t('admin.card.rooms.floorLong', { floor: room.floor }), room.category, room.connection?.explicit ? room.connection.name : null].filter(Boolean).join(' · ')}
              </Box>
            </Box>
            <ControlPill room={room} />
          </Box>
        ))}
      </Box>
    );
  }
  const cell = { p: '9px 12px', borderBottom: `1px solid ${surface.hair}`, color: ink.mid, whiteSpace: 'nowrap' } as const;
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', ...typo.body }} data-testid="admin-rooms-table">
        <Box component="thead">
          <Box component="tr">
            {/* Флажки выбора — столбец без сортировки (сторож сортировки 62-F). */}
            <Box component="th" data-sort="none" sx={{ width: 40, borderBottom: `1px solid ${surface.line}` }}>
              <Checkbox size="small" checked={allOn} indeterminate={!allOn && allIds.some((id) => selected.has(id))} onChange={() => onToggle(allIds)} inputProps={{ 'aria-label': t('admin.card.rooms.sel.allShown'), 'data-testid': 'admin-rooms-check-all' } as never} sx={{ p: 0.5 }} />
            </Box>
            {columns.map((column) => <SortHeader key={column.key} column={column} state={sort} testId={`admin-rooms-sort-${column.key}`} />)}
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map((room) => (
            <Box component="tr" key={room.id} tabIndex={0} data-room-id={room.id} data-testid={`admin-room-${room.number}`} data-selected={selected.has(room.id) ? 'true' : undefined} sx={{ cursor: 'pointer', bgcolor: selected.has(room.id) ? accent.washSoft : undefined, '&:hover, &:focus-visible': { bgcolor: surface.s2, outline: 'none' } }}>
              <Box component="td" sx={{ ...cell, width: 40 }}>{box(room)}</Box>
              <Box component="td" sx={{ ...cell, color: ink.hi, fontWeight: 700 }}>
                <Box component="span" sx={{ display: 'inline-flex', gap: 1, alignItems: 'center' }}>
                  <Dot room={room} layer={layer} swatches={swatches} />
                  <Hl text={room.number} q={search} />
                </Box>
                {!room.is_active ? <Box component="span" sx={{ ml: 1 }}><Pill tone="muted">{t('admin.card.rooms.inactive')}</Pill></Box> : null}
              </Box>
              <Box component="td" sx={cell}>{room.building ? <span data-words="data">{room.building}</span> : '—'}</Box>
              <Box component="td" sx={cell}>
                {room.floor || '—'}
                {room.floor_source === 'rule' ? <SourceMark>{t('admin.card.rooms.card.fromNumber')}</SourceMark> : null}
              </Box>
              <Box component="td" sx={cell}>
                {room.position || '—'}
                {room.position_source === 'manual' ? <SourceMark>{t('admin.card.rooms.card.manual')}</SourceMark> : null}
              </Box>
              <Box component="td" sx={cell}>{room.category ? <span data-words="data">{room.category}</span> : '—'}</Box>
              <Box component="td" sx={cell}>
                {room.variant ? <span data-words="data">{room.variant.title}</span> : <Box component="span" sx={{ color: ink.low }}>{t('admin.card.rooms.noVariant')}</Box>}
              </Box>
              <Box component="td" sx={cell} data-testid={`admin-room-connection-${room.number}`}>
                <ConnectionName connection={room.connection} />
              </Box>
              <Box component="td" sx={cell}><Pill tone={room.pin ? 'ok' : 'muted'}>{t(`admin.card.rooms.pin.${room.pin ? 'yes' : 'no'}`)}</Pill></Box>
              <Box component="td" sx={cell}><ControlPill room={room} /></Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function SourceMark({ children }: { children: ReactNode }) {
  return <Box component="span" sx={{ ...typo.caption, color: ink.low, ml: 0.75 }}>{children}</Box>;
}

function ControlPill({ room }: { room: MapRoom }) {
  const { t } = useTranslation();
  const tone = room.control === 'ok' ? 'ok' : room.control === 'blocked' ? 'bad' : room.control === 'attention' ? 'warn' : 'muted';
  return <Pill tone={tone}>{t(`admin.card.rooms.control.${room.control}`)}</Pill>;
}

/* ── Карточка у курсора ─────────────────────────────────────────────────── */

function RoomFacts({ room, swatches }: { room: MapRoom; swatches: Swatches }) {
  const { t } = useTranslation();
  const row = (label: string, value: ReactNode, testId?: string) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.35, borderBottom: `1px solid ${surface.hair}` }} data-testid={testId}>
      <Box component="span" sx={{ color: ink.mid }}>{label}</Box>
      <Box component="span" sx={{ fontWeight: 700, textAlign: 'end' }}>{value}</Box>
    </Box>
  );
  const control = swatches.swatchOf(room, 'control');
  return (
    <Box sx={{ display: 'grid', gap: 0.25 }}>
      <Box sx={{ ...typo.panelTitle, mb: 0.5 }}>{t('admin.card.rooms.card.title', { number: room.number })}</Box>
      {row(t('admin.card.rooms.card.building'), room.building ? <span data-words="data">{room.building}</span> : t('admin.card.rooms.noBuilding'))}
      {row(
        t('admin.card.rooms.card.floor'),
        <>
          {room.floor || t('admin.card.rooms.card.notSet')}
          {room.floor_source === 'rule' ? <SourceMark>{t('admin.card.rooms.card.fromNumber')}</SourceMark> : null}
        </>,
      )}
      {row(
        t('admin.card.rooms.card.position'),
        <>
          {room.position || t('admin.card.rooms.card.notSet')}
          {room.position_source !== 'none' ? (
            <SourceMark>{t(room.position_source === 'manual' ? 'admin.card.rooms.card.manual' : 'admin.card.rooms.card.byRule')}</SourceMark>
          ) : null}
        </>,
        'admin-room-card-position',
      )}
      {row(t('admin.card.rooms.card.category'), room.category ? <span data-words="data">{room.category}</span> : t('admin.card.rooms.card.notSet'))}
      {row(t('admin.card.rooms.card.variant'), room.variant ? <span data-words="data">{room.variant.title}</span> : t('admin.card.rooms.card.noVariant'))}
      {row(t('admin.card.rooms.card.connection'), <ConnectionName connection={room.connection} />)}
      {row(t('admin.card.rooms.card.pin'), t(room.pin ? 'admin.card.rooms.card.yes' : 'admin.card.rooms.card.no'))}
      {row(t('admin.card.rooms.card.control'), `${control.glyph} ${control.label}`)}
      {room.problems.length ? (
        <Box sx={{ pt: 0.5 }}>
          <Box sx={{ color: ink.mid }}>{t('admin.card.rooms.card.problems')}</Box>
          {room.problems.map((code) => (
            <Box key={code} sx={{ fontWeight: 700, color: code === 'demo_entry' ? state.warn : state.bad }}>· {t(`admin.card.rooms.problem.${code}`)}</Box>
          ))}
        </Box>
      ) : null}
      <Box sx={{ color: ink.low, pt: 0.5 }}>{t('admin.card.rooms.card.open')}</Box>
    </Box>
  );
}

/**
 * Подключение номера словами (партия 65): имя; у номера без своего
 * назначения — «по умолчанию», потому что он поедет за подключением по
 * умолчанию, если его сменят.
 */
export function ConnectionName({ connection }: { connection: MapRoom['connection'] }) {
  const { t } = useTranslation();
  if (!connection) return <Box component="span" sx={{ color: ink.low }}>{t('admin.card.rooms.noConnection')}</Box>;
  return (
    <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
      <span data-words="data">{connection.name}</span>
      {!connection.explicit ? (
        <Box component="span" sx={{ ...typo.caption, color: ink.low }}>{t('admin.card.rooms.connectionByDefault')}</Box>
      ) : null}
    </Box>
  );
}
