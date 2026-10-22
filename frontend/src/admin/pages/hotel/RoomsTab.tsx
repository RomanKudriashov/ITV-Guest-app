import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import FitScreenOutlinedIcon from '@mui/icons-material/FitScreenOutlined';
import TableRowsOutlinedIcon from '@mui/icons-material/TableRowsOutlined';
import ViewModuleOutlinedIcon from '@mui/icons-material/ViewModuleOutlined';
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';
import { accent, fieldSx, ink, panelSx, primaryButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../../adminTokens';
import { getRoomsMap, putRoomPlace, putRoomRule, type MapRoom, type RoomRule, type RoomsMap } from '../../adminClient';
import { AdminDialog } from '../../form';
import { useRights } from '../../useRights';
import { Empty, FilterBar, Help, Hl, Panel, Pill, ViewSwitch, type Facet } from '../hotels/hotelsUi';
import { SortBar, SortHeader, useSort, type SortState } from '../../sort';
import {
  BuildingBlocks,
  BuildingScheme,
  CursorCard,
  LAYERS,
  Legend,
  PROBLEM_ORDER,
  RoomCell,
  ZOOM_STEPS,
  highlightSx,
  useCursorCard,
  useSwatches,
  type Layer,
  type Swatches,
} from './roomsMap';

/**
 * НОМЕРНОЙ ФОНД — ПРОСМОТР (партия 63-1, вариант А макетов 63-М).
 *
 * Виды Схема (по умолчанию) · Блоки · Таблица, слой цветом с легендой,
 * «Что исправить» сверху, поиск и фильтры чипами — всё в адресе. Схема
 * вписывается в экран целиком; крупнее — кнопками масштаба. Этаж и позиция
 * (стояк) — заданные у номера или прочитанные из номера по правилу отеля.
 * Действий над номерами здесь нет (партия 63-2); правится только правило
 * отеля и позиция отдельного номера.
 */

const FACET_KEYS = ['building', 'floor', 'category', 'variant', 'pin', 'control', 'problem'] as const;
const SORT_KEYS = ['number', 'building', 'floor', 'position', 'category', 'variant', 'pin', 'control'] as const;
type View = 'table' | 'blocks' | 'scheme';

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
  const [params, set] = useParam();
  const narrow = useMediaQuery('(max-width:899px)');
  const view = (params.get('view') as View) || 'scheme';
  const layer: Layer = LAYERS.includes(params.get('layer') as Layer) ? (params.get('layer') as Layer) : 'control';
  const zoom = Math.min(Math.max(Number(params.get('zoom')) || 0, 0), ZOOM_STEPS.length - 1);
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
    const value = delta === null ? 0 : Math.min(Math.max(zoomRef.current + delta, 0), ZOOM_STEPS.length - 1);
    zoomRef.current = value;
    set({ zoom: value ? String(value) : null });
  };
  const [highlight, setHighlight] = useState<string | null>(null);
  const [open, setOpen] = useState<MapRoom | null>(null);

  const rooms = useMemo(() => data.buildings.flatMap((b) => b.floors.flatMap((f) => f.rooms)), [data]);
  const byId = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const swatches = useSwatches(rooms);
  const card = useCursorCard(byId, !narrow);

  const facets: Facet[] = FACET_KEYS.map((key) => ({
    key,
    label: t(`admin.card.rooms.facet.${key}`),
    options: data.facets[key].map((o) => ({ value: o.value, label: facetLabel(t, key, o.value, o.label), count: o.count })),
    describe: (value: string) => facetLabel(t, key, value, value),
  }));

  if (!data.total) {
    return (
      <Panel title={t('admin.card.rooms.title')}>
        <Empty title={t('admin.card.rooms.emptyTitle')} testId="admin-rooms-empty">{t('admin.card.rooms.emptyBody')}</Empty>
      </Panel>
    );
  }

  const openRoom = (event: React.MouseEvent | React.KeyboardEvent) => {
    if ('key' in event && event.key !== 'Enter' && event.key !== ' ') return;
    const target = (event.target as HTMLElement).closest('[data-room-id]') as HTMLElement | null;
    const room = target ? byId.get(target.dataset.roomId ?? '') : undefined;
    if (room) setOpen(room);
  };

  return (
    <Box sx={{ display: 'grid', gap: 1.5, minWidth: 0 }}>
      <FixPanel data={data} />
      <RuleStrip hotelId={hotelId} data={data} sample={rooms[0]?.number ?? '2205'} />
      <Box sx={{ ...panelSx, p: { xs: 1.25, md: 2 }, minWidth: 0 }}>
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
                ['table', t('admin.card.rooms.view.table'), <TableRowsOutlinedIcon key="t" fontSize="small" />],
                ['blocks', t('admin.card.rooms.view.blocks'), <ViewModuleOutlinedIcon key="b" fontSize="small" />],
                ['scheme', t('admin.card.rooms.view.scheme'), <ApartmentOutlinedIcon key="s" fontSize="small" />],
              ]}
            />
          }
        />
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
          <LayerPicker layer={layer} onChange={(next) => set({ layer: next === 'control' ? null : next })} />
          <Box sx={{ flex: 1 }} />
          {view === 'scheme' ? <ZoomBar zoom={zoom} onStep={step} /> : null}
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
            sx={{ display: 'grid', gap: 2, minWidth: 0, ...highlightSx(highlight) }}
            {...card.handlers}
            onClick={openRoom}
            onKeyDown={openRoom}
            data-testid="admin-rooms-body"
          >
            {view === 'table' ? (
              <RoomsTable data={data} byId={byId} search={search} sort={sort} narrow={narrow} layer={layer} swatches={swatches} />
            ) : (
              data.buildings.map((building) => (
                <Box key={building.key || 'none'} sx={{ minWidth: 0 }} data-testid={`admin-rooms-building-${building.key || 'none'}`}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                    <Typography component="h3" sx={{ ...typo.panelTitle, color: ink.hi }}>
                      {building.title ? <span data-words="data">{building.title}</span> : t('admin.card.rooms.noBuilding')}
                    </Typography>
                    <Box sx={{ ...typo.caption, color: ink.low }}>{t('admin.card.rooms.roomsCount', { count: building.rooms })}</Box>
                  </Box>
                  {view === 'scheme' ? (
                    <BuildingScheme building={building} layer={layer} swatches={swatches} zoom={zoom} narrow={narrow} />
                  ) : (
                    <BuildingBlocks building={building} layer={layer} swatches={swatches} />
                  )}
                </Box>
              ))
            )}
          </Box>
        )}
      </Box>
      <CursorCard hover={card.hover}>{card.hover ? <RoomFacts room={card.hover.room} swatches={swatches} /> : null}</CursorCard>
      <RoomSheet hotelId={hotelId} room={open} onClose={() => setOpen(null)} narrow={narrow} swatches={swatches} />
    </Box>
  );
}

function facetLabel(t: (k: string, o?: Record<string, unknown>) => string, key: string, value: string, fallback: string) {
  if (value === 'none') {
    if (key === 'building') return t('admin.card.rooms.noBuilding');
    if (key === 'floor') return t('admin.card.rooms.noFloor');
    if (key === 'variant') return t('admin.card.rooms.noVariantValue');
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
          {t('admin.card.rooms.rule.stats', { rule: data.summary.rule_floors, manual: data.summary.manual_positions })}
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
      {button(t('admin.card.rooms.zoom.out'), <RemoveIcon fontSize="small" />, () => onStep(-1), zoom === 0, 'admin-rooms-zoom-out')}
      {button(t('admin.card.rooms.zoom.in'), <AddIcon fontSize="small" />, () => onStep(1), zoom >= ZOOM_STEPS.length - 1, 'admin-rooms-zoom-in')}
      <Button size="small" sx={{ ...secondaryButtonSx, gap: 0.5 }} onClick={() => onStep(null)} disabled={zoom === 0} data-testid="admin-rooms-zoom-fit">
        <FitScreenOutlinedIcon fontSize="small" />
        {zoom === 0 ? t('admin.card.rooms.zoom.fitted') : t('admin.card.rooms.zoom.fit')}
      </Button>
    </Box>
  );
}

/* ── Таблица ────────────────────────────────────────────────────────────── */

function RoomsTable({
  data,
  byId,
  search,
  sort,
  narrow,
  layer,
  swatches,
}: {
  data: RoomsMap;
  byId: Map<string, MapRoom>;
  search: string;
  sort: SortState;
  narrow: boolean;
  layer: Layer;
  swatches: Swatches;
}) {
  const { t } = useTranslation();
  const rows = data.order.map((id) => byId.get(id)).filter(Boolean) as MapRoom[];
  const columns = SORT_KEYS.map((key) => ({ key, label: t(`admin.card.rooms.col.${key}`) }));
  if (narrow) {
    return (
      <Box sx={{ display: 'grid', gap: 1 }}>
        <SortBar columns={columns} state={sort} testId="admin-rooms-sort" />
        {rows.map((room) => (
          <Box key={room.id} data-room-id={room.id} sx={{ ...panelSx, p: 1.25, display: 'flex', gap: 1, alignItems: 'center', cursor: 'pointer' }}>
            <Box sx={{ width: 34, height: 26, display: 'flex', flex: 'none' }}>
              <RoomCell room={room} layer={layer} swatches={swatches} showNumber={false} showGlyph />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>
                <Hl text={room.number} q={search} />
              </Box>
              <Box sx={{ ...typo.caption, color: ink.mid }}>
                {[room.building, room.floor && t('admin.card.rooms.floorLong', { floor: room.floor }), room.category].filter(Boolean).join(' · ')}
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
            {columns.map((column) => <SortHeader key={column.key} column={column} state={sort} testId={`admin-rooms-sort-${column.key}`} />)}
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map((room) => (
            <Box component="tr" key={room.id} data-room-id={room.id} data-testid={`admin-room-${room.number}`} sx={{ cursor: 'pointer', '&:hover': { bgcolor: surface.s2 } }}>
              <Box component="td" sx={{ ...cell, color: ink.hi, fontWeight: 700 }}>
                <Hl text={room.number} q={search} />
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

/* ── Карточка и лист номера ─────────────────────────────────────────────── */

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
    </Box>
  );
}

function RoomSheet({ hotelId, room, onClose, narrow, swatches }: { hotelId: string; room: MapRoom | null; onClose: () => void; narrow: boolean; swatches: Swatches }) {
  const { t } = useTranslation();
  return (
    <Drawer
      anchor={narrow ? 'bottom' : 'right'}
      open={Boolean(room)}
      onClose={onClose}
      PaperProps={{
        sx: {
          bgcolor: surface.s1,
          color: ink.hi,
          width: narrow ? '100%' : 380,
          maxHeight: narrow ? '85vh' : '100%',
          borderRadius: narrow ? `${shape.radius}px ${shape.radius}px 0 0` : 0,
          p: 2,
        },
      }}
    >
      {room ? (
        <Box data-testid="admin-room-sheet" sx={{ display: 'grid', gap: 2 }}>
          <RoomFacts room={room} swatches={swatches} />
          <PlaceEditor hotelId={hotelId} room={room} />
          <Button sx={secondaryButtonSx} onClick={onClose}>{t('admin.card.rooms.place.close')}</Button>
        </Box>
      ) : null}
    </Drawer>
  );
}

function PlaceEditor({ hotelId, room }: { hotelId: string; room: MapRoom }) {
  const { t } = useTranslation();
  const { canWrite } = useRights();
  const client = useQueryClient();
  const [value, setValue] = useState(room.position_source === 'manual' ? room.position : '');
  const [done, setDone] = useState(false);
  const save = useMutation({
    mutationFn: (position: string) => putRoomPlace(hotelId, room.id, position),
    onSuccess: async () => {
      setDone(true);
      await client.invalidateQueries({ queryKey: ['admin', 'hotel-rooms-map', hotelId] });
    },
  });
  if (!canWrite) return null;
  const byRule = room.position_source === 'rule' ? room.position : '';
  return (
    <Box sx={{ display: 'grid', gap: 1 }} data-testid="admin-room-place">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Box sx={{ ...typo.label, color: ink.mid }}>{t('admin.card.rooms.place.title')}</Box>
        <Help>{t('admin.card.rooms.place.help')}</Help>
      </Box>
      {room.position_source !== 'manual' ? (
        <Typography sx={{ ...typo.caption, color: ink.mid }}>
          {byRule ? t('admin.card.rooms.place.byRule', { position: byRule }) : t('admin.card.rooms.place.byRuleNone')}
        </Typography>
      ) : null}
      <TextField
        size="small"
        label={t('admin.card.rooms.place.manualLabel')}
        value={value}
        onChange={(e) => {
          setValue(e.target.value.slice(0, 16));
          setDone(false);
        }}
        sx={fieldSx}
        inputProps={{ 'data-testid': 'admin-room-place-input' }}
      />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="small" sx={primaryButtonSx} disabled={save.isPending || !value.trim()} onClick={() => save.mutate(value.trim())} data-testid="admin-room-place-save">
          {t('admin.card.rooms.place.save')}
        </Button>
        {room.position_source === 'manual' ? (
          <Button size="small" sx={secondaryButtonSx} disabled={save.isPending} onClick={() => { setValue(''); save.mutate(''); }} data-testid="admin-room-place-reset">
            {t('admin.card.rooms.place.reset')}
          </Button>
        ) : null}
        {done ? <Box sx={{ ...typo.caption, color: state.ok }}>{t('admin.card.rooms.place.saved')}</Box> : null}
      </Box>
      {save.isError ? <Typography sx={{ ...typo.caption, color: state.bad }}>{(save.error as Error).message}</Typography> : null}
    </Box>
  );
}
