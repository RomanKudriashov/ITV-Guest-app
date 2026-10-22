import { useState, type DragEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';
import { useTranslation } from 'react-i18next';

import { PlainHeader, SortBar, SortHeader, useSort, type SortState } from '../sort';

import { glassSx } from '@/kit/glass';
import { QueryState } from '@/components/QueryState';
import { useActionFailed } from '@/hooks/useActionFailed';
import { useRights } from '../useRights';
import { accent, ink, panelSx, primaryButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../adminTokens';
import { CreateHotelDialog, CreatedAdminDialog } from '../CreateHotelDialog';
import {
  bulkSetActive,
  downloadFleetCsv,
  getGroups,
  getHotelsView,
  moveHotels,
  type CreateHotelResult,
  type GroupSummary,
  type HotelGroup,
  type HotelState,
  type HotelViewRow,
  type LinkKind,
} from '../adminClient';
import { CreateGroupDialog, DeleteGroupDialog, EditGroupDialog, MoveDialog } from './hotels/groupDialogs';
import { Dot, Empty, FilterBar, GroupMark, Help, Hl, Pill, ViewSwitch, useFacetValues, type Facet, type Tone } from './hotels/hotelsUi';
import { DisableDialog } from './hotel/hotelDialogs';

/**
 * «ОТЕЛИ» (партия 62-A1, по утверждённому макету): группы отелей одного
 * владельца раскрывающимися блоками со сводкой, ниже — «Отели без группы»;
 * или общим списком. Один поиск по отелям и группам с подсветкой, фильтры
 * чипами — всё в адресе: ссылка на выборку открывает ту же выборку.
 *
 * Раздел «Группы» влился сюда: группы заводятся, правятся, удаляются и
 * наполняются прямо на этом экране.
 */

const FACETS = ['state', 'link', 'module', 'group'] as const;
const LINK_TONE: Record<LinkKind, Tone> = { online: 'ok', silent: 'bad', none: 'muted' };
const STATE_TONE: Record<HotelState, Tone> = { problems: 'warn', ready: 'ok', disabled: 'muted' };
const MODULE_CODES = ['room_control', 'marketing', 'pms', 'payment', 'mobile_key', 'native_app', 'analytics_level', 'multi_restaurant', 'extra_languages'];

const stateOf = (row: HotelViewRow): HotelState => (!row.is_active ? 'disabled' : row.problems ? 'problems' : 'ready');

export function FleetPage({ onOpenHotel }: { onOpenHotel: (id: string) => void }) {
  const { t } = useTranslation();
  const { canWrite } = useRights();
  const qc = useQueryClient();
  const actionFailed = useActionFailed();
  const narrow = useMediaQuery('(max-width:899px)');
  const [params, setParams] = useSearchParams();
  const layout = params.get('layout') === 'list' ? 'list' : 'groups';
  const search = params.get('search') ?? '';
  const values = useFacetValues([...FACETS]);
  const closed = new Set((params.get('closed') ?? '').split(',').filter(Boolean));
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'create-group' | 'move' | 'disable'>(null);
  const [editing, setEditing] = useState<HotelGroup | null>(null);
  const [deleting, setDeleting] = useState<HotelGroup | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreateHotelResult | null>(null);

  const sort = useSort('', FLEET_SORTS);
  const query: Record<string, string> = { layout, ...sort.query };
  if (search) query.search = search;
  for (const key of FACETS) if (values[key].length) query[key] = values[key].join(',');
  const origin = params.get('origin');
  if (origin) query.origin = origin;

  // Ключи под ['admin', 'fleet']: карточка отеля и создание отеля сбрасывают
  // именно его — иначе отключённый в карточке отель оставался «готов» в списке.
  const view = useQuery({ queryKey: ['admin', 'fleet', 'view', query], queryFn: () => getHotelsView(query) });
  // Все отели без фильтров — для окна новой группы (выбор отелей) и подсчёта.
  const all = useQuery({ queryKey: ['admin', 'fleet', 'all', origin], queryFn: () => getHotelsView(origin ? { layout: 'list', origin } : { layout: 'list' }) });
  const groups = useQuery({ queryKey: ['admin', 'groups'], queryFn: getGroups });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'groups'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
  };
  const drop = useMutation({
    mutationFn: ({ hotelId, groupId }: { hotelId: string; groupId: string | null }) => moveHotels([hotelId], groupId),
    onSuccess: invalidate,
    onError: actionFailed,
  });
  const bulk = useMutation({
    mutationFn: ({ isActive, reason, enable_on }: { isActive: boolean; reason?: string; enable_on?: string | null }) =>
      bulkSetActive(selected, isActive, undefined, isActive ? undefined : { reason: reason ?? '', enable_on }),
    onSuccess: () => {
      setSelected([]);
      invalidate();
    },
    onError: actionFailed,
  });

  const setClosed = (id: string) => {
    const next = new URLSearchParams(params);
    const now = new Set(closed);
    if (now.has(id)) now.delete(id);
    else now.add(id);
    if (now.size) next.set('closed', [...now].join(','));
    else next.delete('closed');
    setParams(next, { replace: true });
  };
  // Страница группы (партия 62-A2): шагом истории, «назад» вернёт к списку.
  const openGroup = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('gpage', id);
    next.set('gtab', 'summary');
    for (const key of ['search', ...FACETS]) next.delete(key);
    setParams(next);
  };
  const setLayout = (value: 'groups' | 'list') => {
    const next = new URLSearchParams(params);
    if (value === 'groups') next.delete('layout');
    else next.set('layout', value);
    setParams(next, { replace: true });
  };

  const facets = view.data?.facets;
  const count = (key: (typeof FACETS)[number], value: string) => facets?.[key]?.[value] ?? 0;
  const groupList = groups.data?.items ?? [];
  const facetList: Facet[] = [
    {
      key: 'state',
      label: t('admin.hotels.filter.state'),
      options: (['problems', 'ready', 'disabled'] as HotelState[]).map((s) => ({ value: s, label: t(`admin.hotels.state.${s}`), tone: STATE_TONE[s], count: count('state', s) })),
    },
    {
      key: 'link',
      label: t('admin.hotels.filter.link'),
      options: (['online', 'silent', 'none'] as LinkKind[]).map((k) => ({ value: k, label: t(`admin.hotels.link.${k}`), tone: LINK_TONE[k], count: count('link', k) })),
    },
    {
      key: 'module',
      label: t('admin.hotels.filter.module'),
      options: MODULE_CODES.map((code) => ({ value: code, label: t(`admin.module.${code}`), count: count('module', code) })),
    },
    {
      key: 'group',
      label: t('admin.hotels.filter.group'),
      options: [
        ...groupList.map((g) => ({ value: g.id, label: g.title, count: count('group', g.id) })),
        { value: 'none', label: t('admin.hotels.ungrouped.title'), count: count('group', 'none') },
      ],
    },
  ];

  const filtering = Boolean(search) || FACETS.some((k) => values[k].length);
  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const rowProps = {
    sort,
    selected,
    onToggle: toggle,
    onOpen: onOpenHotel,
    q: search,
    narrow,
    draggable: canWrite,
  };
  const resetAll = () => {
    const next = new URLSearchParams(params);
    for (const key of ['search', ...FACETS]) next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <Box data-testid="admin-fleet">
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
          <Typography component="h1" sx={{ ...typo.pageTitle, color: ink.hi }}>{t('admin.hotels.title')}</Typography>
          <Typography sx={{ ...typo.body, color: ink.mid, mt: 0.5 }}>{t('admin.hotels.subtitle')}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button onClick={() => void downloadFleetCsv({ search })} data-testid="admin-fleet-export" sx={secondaryButtonSx}>
            {t('admin.hotels.export')}
          </Button>
          {canWrite ? (
            <>
              <Button onClick={() => setDialog('create-group')} data-testid="admin-group-create-open" sx={secondaryButtonSx}>
                {t('admin.hotels.newGroup')}
              </Button>
              <Button onClick={() => setCreating(true)} data-testid="admin-create-open" sx={primaryButtonSx}>
                {t('admin.hotels.newHotel')}
              </Button>
            </>
          ) : null}
        </Box>
      </Box>

      {/* Фильтры — на стекле (партия 56: стекло на рамке), реестр — плотный. */}
      <Box sx={[(theme) => ({ ...glassSx(theme, 'panel'), borderRadius: `${theme.palette.brand.radius.lg}px`, p: 1.5, pb: 0.25, mb: 1.5 })]}>
      <FilterBar
        facets={facetList}
        placeholder={t('admin.hotels.searchPlaceholder')}
        aside={
          <ViewSwitch
            label={t('admin.hotels.layout.label')}
            value={layout}
            onChange={setLayout}
            options={[
              ['groups', t('admin.hotels.layout.groups'), <AccountTreeOutlinedIcon key="g" fontSize="small" />],
              ['list', t('admin.hotels.layout.list'), <ViewListOutlinedIcon key="l" fontSize="small" />],
            ]}
          />
        }
      />
      </Box>

      {canWrite && selected.length ? (
        <Box
          data-testid="admin-fleet-bulkbar"
          sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5, p: 1.25, borderRadius: `${shape.radiusLarge}px`, bgcolor: accent.washSoft, border: `1px solid ${accent.main}` }}
        >
          <Typography sx={{ ...typo.caption, fontWeight: 700, color: accent.soft, mr: 1 }}>{t('admin.hotels.selected', { count: selected.length })}</Typography>
          <Button size="small" sx={secondaryButtonSx} onClick={() => setDialog('move')} data-testid="admin-hotels-bulk-move">
            {t('admin.hotels.bulk.move')}
          </Button>
          <Button size="small" sx={secondaryButtonSx} onClick={() => bulk.mutate({ isActive: true })} disabled={bulk.isPending} data-testid="admin-fleet-bulk-enable">
            {t('admin.hotels.bulk.enable')}
          </Button>
          <Button size="small" sx={{ ...secondaryButtonSx, color: state.bad }} onClick={() => setDialog('disable')} disabled={bulk.isPending} data-testid="admin-fleet-bulk-disable">
            {t('admin.hotels.bulk.disable')}
          </Button>
          <Button size="small" sx={{ ml: 'auto', color: ink.mid }} onClick={() => setSelected([])}>{t('admin.hotels.bulk.clear')}</Button>
        </Box>
      ) : null}

      {/* Телефон: таблиц нет — «Сортировать по» над карточками, один на
          экран: внутри каждой группы порядок тот же (партия 62-F). */}
      {narrow ? (
        <Box sx={{ mb: 1.5 }}>
          <SortBar
            state={sort}
            testId="admin-fleet-sort-bar"
            columns={[
              { key: 'name', label: t('admin.hotels.col.hotel') },
              ...(layout === 'list' ? [{ key: 'group', label: t('admin.hotels.col.group') }] : []),
              { key: 'rooms', label: t('admin.hotels.col.rooms') },
              { key: 'modules', label: t('admin.hotels.col.modules') },
              { key: 'link', label: t('admin.hotels.col.link') },
              { key: 'state', label: t('admin.hotels.col.state') },
            ]}
          />
        </Box>
      ) : null}
            <QueryState query={view} what={t('state.what.fleet')}>
        {(data) =>
          !data.total && filtering ? (
            <Box sx={panelSx}>
              <Empty title={t('admin.hotels.empty.title')} action={<Button sx={secondaryButtonSx} onClick={resetAll}>{t('admin.hotels.empty.reset')}</Button>}>
                {t('admin.hotels.empty.body')}
              </Empty>
            </Box>
          ) : !data.total ? (
            // Отелей нет вовсе — фраза, а не пустое место (сторож `console-states`).
            <Box sx={panelSx}>
              <Empty title={t('admin.hotels.empty.noneTitle')} testId="state-empty">
                {t('admin.hotels.empty.noneBody')}
              </Empty>
            </Box>
          ) : data.layout === 'list' ? (
            <HotelRows rows={data.items} showGroup {...rowProps} />
          ) : (
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              {data.groups.map((g) => (
                <GroupBlock
                  key={g.id}
                  testId={`admin-hotels-group-${g.code}`}
                  title={<Hl text={g.title} q={search} />}
                  color={g}
                  description={g.description}
                  summary={g.summary}
                  open={filtering || !closed.has(g.id)}
                  onToggle={() => setClosed(g.id)}
                  onOpen={() => openGroup(g.id)}
                  onDrop={canWrite ? (hotelId) => drop.mutate({ hotelId, groupId: g.id }) : undefined}
                  actions={
                    canWrite ? (
                      <>
                        <Button size="small" sx={{ color: ink.mid }} onClick={() => setEditing(g)} data-testid={`admin-group-edit-${g.code}`}>{t('admin.hotels.group.edit')}</Button>
                        <Button size="small" sx={{ color: ink.mid }} onClick={() => setDeleting(g)} data-testid={`admin-group-delete-${g.code}`}>{t('admin.hotels.group.delete')}</Button>
                      </>
                    ) : null
                  }
                >
                  {g.items.length ? (
                    <HotelRows rows={g.items} {...rowProps} />
                  ) : (
                    <Typography sx={{ ...typo.body, color: ink.mid, p: 2 }}>{t('admin.hotels.group.emptyHint')}</Typography>
                  )}
                </GroupBlock>
              ))}
              {data.ungrouped && (data.ungrouped.items.length || !filtering) ? (
                <GroupBlock
                  testId="admin-hotels-group-none"
                  title={t('admin.hotels.ungrouped.title')}
                  summary={data.ungrouped.summary}
                  hint={t('admin.hotels.ungrouped.hint')}
                  open={filtering || !closed.has('none')}
                  onToggle={() => setClosed('none')}
                  onDrop={canWrite ? (hotelId) => drop.mutate({ hotelId, groupId: null }) : undefined}
                  muted
                >
                  {data.ungrouped.items.length ? (
                    <HotelRows rows={data.ungrouped.items} {...rowProps} />
                  ) : (
                    <Typography sx={{ ...typo.body, color: ink.mid, p: 2 }}>{t('admin.hotels.ungrouped.empty')}</Typography>
                  )}
                </GroupBlock>
              ) : null}
            </Box>
          )
        }
      </QueryState>

      {dialog === 'create-group' ? <CreateGroupDialog rows={all.data?.items ?? []} onClose={() => setDialog(null)} /> : null}
      {dialog === 'move' ? (
        <MoveDialog
          hotelIds={selected}
          groups={groupList}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setSelected([]);
          }}
        />
      ) : null}
      {editing ? <EditGroupDialog group={editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? <DeleteGroupDialog group={deleting} rows={all.data?.items ?? []} onClose={() => setDeleting(null)} /> : null}
      {/* Массовое отключение — тем же окном, что в карточке: причина обязательна (62-C). */}
      {dialog === 'disable' ? (
        <DisableDialog
          title={t('admin.hotels.bulk.disableTitle', { count: selected.length })}
          busy={bulk.isPending}
          onSubmit={(body) => {
            setDialog(null);
            bulk.mutate({ isActive: false, ...body });
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {creating ? (
        <CreateHotelDialog
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false);
            setCreated(result);
            invalidate();
          }}
        />
      ) : null}
      {created ? <CreatedAdminDialog admin={created.admin} services={created.services ?? []} onClose={() => setCreated(null)} /> : null}
    </Box>
  );
}

/* ── Группа ─────────────────────────────────────────────────────────────── */

function GroupBlock({
  testId,
  title,
  color,
  description,
  summary,
  hint,
  open,
  onToggle,
  onOpen,
  onDrop,
  actions,
  muted,
  children,
}: {
  testId: string;
  title: ReactNode;
  color?: HotelGroup;
  description?: string;
  summary: GroupSummary;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  onOpen?: () => void;
  onDrop?: (hotelId: string) => void;
  actions?: ReactNode;
  muted?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  const linkPart = (kind: LinkKind, n: number) =>
    n ? (
      <Box component="span" key={kind} sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center', whiteSpace: 'nowrap' }}>
        <Dot tone={LINK_TONE[kind]} />
        {t(`admin.hotels.summary.link.${kind}`, { count: n })}
      </Box>
    ) : null;
  return (
    <Box
      data-testid={testId}
      onDragOver={onDrop ? (e: DragEvent) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={onDrop ? () => setOver(false) : undefined}
      onDrop={
        onDrop
          ? (e: DragEvent) => {
              e.preventDefault();
              setOver(false);
              const id = e.dataTransfer.getData('text/hotel');
              if (id) onDrop(id);
            }
          : undefined
      }
      sx={{ ...panelSx, p: 0, overflow: 'hidden', outline: over ? `2px dashed ${accent.main}` : 'none' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1.25, flexWrap: 'wrap', borderBottom: open ? `1px solid ${surface.line}` : 'none' }}>
        <ButtonBase onClick={onToggle} aria-expanded={open} aria-label={t(open ? 'admin.groupPage.collapse' : 'admin.groupPage.expand')} data-testid={`${testId}-toggle`} sx={{ borderRadius: `${shape.radius}px`, p: 0.25 }}>
          {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
        </ButtonBase>
        {color ? <GroupMark color={color.color} /> : null}
        <ButtonBase onClick={onOpen ?? onToggle} data-testid={`${testId}-open`} sx={{ borderRadius: `${shape.radius}px`, pr: 1, textAlign: 'left', minWidth: 0 }}>
          <Typography
            component="h2"
            sx={{ ...typo.panelTitle, color: muted ? ink.mid : ink.hi, textDecoration: onOpen ? 'underline' : 'none', textDecorationColor: surface.line, textUnderlineOffset: '4px' }}
          >
            {title}
          </Typography>
        </ButtonBase>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', ...typo.caption, color: ink.mid, flex: '1 1 auto' }} data-testid={`${testId}-summary`}>
          <span>{t('admin.hotels.summary.hotels', { count: summary.hotels })}</span>
          <span>{t('admin.hotels.summary.rooms', { count: summary.rooms })}</span>
          {summary.problems ? (
            <Pill tone="warn">{t('admin.hotels.summary.problems', { count: summary.problems })}</Pill>
          ) : summary.active ? (
            <Pill tone="ok">{t('admin.hotels.summary.noProblems')}</Pill>
          ) : null}
          {linkPart('silent', summary.link.silent)}
          {linkPart('online', summary.link.online)}
          {linkPart('none', summary.link.none)}
        </Box>
        {actions}
      </Box>
      {open ? (
        <Box>
          {description ? <Typography sx={{ ...typo.caption, color: ink.mid, px: 2, pt: 1 }}>{description}</Typography> : null}
          {hint ? <Typography sx={{ ...typo.caption, color: ink.mid, px: 2, pt: 1 }}>{hint}</Typography> : null}
          {children}
        </Box>
      ) : null}
    </Box>
  );
}

/* ── Отели: таблица на широком экране, карточки на телефоне ─────────────── */

function ModulesCell({ codes }: { codes: string[] }) {
  const { t } = useTranslation();
  if (!codes.length) return <Box component="span" sx={{ color: ink.low }}>—</Box>;
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {codes.map((code) => (
        <Pill key={code} tone={code === 'room_control' || code === 'marketing' ? 'info' : 'muted'}>{t(`admin.module.${code}`)}</Pill>
      ))}
    </Box>
  );
}

function StateCell({ row }: { row: HotelViewRow }) {
  const { t } = useTranslation();
  const s = stateOf(row);
  return (
    <Pill tone={STATE_TONE[s]} testId={`admin-fleet-status-${row.subdomain}`}>
      {s === 'problems' ? t('admin.hotels.summary.problems', { count: row.problems }) : t(`admin.hotels.state.${s}`)}
    </Pill>
  );
}

function LinkCell({ kind }: { kind: LinkKind }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, whiteSpace: 'nowrap', color: kind === 'none' ? ink.low : ink.hi }}>
      <Dot tone={LINK_TONE[kind]} />
      {t(`admin.hotels.link.${kind}`)}
    </Box>
  );
}

/** Столбцы «Отелей», которые сортирует сервер (партия 62-F). */
const FLEET_SORTS = ['name', 'group', 'rooms', 'modules', 'link', 'state'] as const;

function HotelRows({
  sort,
  rows,
  selected,
  onToggle,
  onOpen,
  q,
  narrow,
  draggable,
  showGroup = false,
}: {
  rows: HotelViewRow[];
  selected: string[];
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  q: string;
  narrow: boolean;
  draggable: boolean;
  showGroup?: boolean;
  sort: SortState;
}) {
  const { t } = useTranslation();
  const col = (key: string, label: string) => ({ key, label });
  const drag = (id: string) =>
    draggable ? { draggable: true, onDragStart: (e: DragEvent) => e.dataTransfer.setData('text/hotel', id) } : {};

  if (narrow) {
    return (
      <Box sx={{ display: 'grid', gap: 1, p: showGroup ? 0 : 1 }}>
        {rows.map((r) => (
          <Box
            key={r.id}
            data-testid={`admin-fleet-row-${r.subdomain}`}
            {...drag(r.id)}
            sx={{ ...panelSx, p: 1.5, display: 'flex', gap: 1, opacity: r.is_active ? 1 : 0.62, outline: selected.includes(r.id) ? `2px solid ${accent.main}` : 'none' }}
          >
            <Checkbox size="small" checked={selected.includes(r.id)} onChange={() => onToggle(r.id)} sx={{ alignSelf: 'flex-start', m: -0.75 }} inputProps={{ 'aria-label': t('admin.hotels.pick', { name: r.name }), 'data-testid': `admin-fleet-pick-${r.subdomain}` } as Record<string, string>} />
            <ButtonBase onClick={() => onOpen(r.id)} data-testid={`admin-fleet-open-${r.subdomain}`} sx={{ flex: 1, minWidth: 0, display: 'block', textAlign: 'left' }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}><Hl text={r.name} q={q} /></Box>
                  <Box sx={{ ...typo.caption, color: ink.mid }}>
                    <Hl text={r.subdomain} q={q} /> · {t('admin.hotels.summary.rooms', { count: r.counts.rooms })}
                    {showGroup && r.group ? <> · <Hl text={r.group.title} q={q} /></> : null}
                  </Box>
                </Box>
                <StateCell row={r} />
              </Box>
              <Box sx={{ mt: 1, ...typo.caption }}><LinkCell kind={r.link} /></Box>
              {r.modules.length ? <Box sx={{ mt: 1 }}><ModulesCell codes={r.modules} /></Box> : null}
            </ButtonBase>
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box sx={showGroup ? { ...panelSx, p: 0, overflowX: 'auto' } : { overflowX: 'auto' }}>
      {/* Ширины закреплены: таблицы групп стоят одна под другой и должны идти
          ровными столбцами. */}
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 860, ...typo.body }}>
        <colgroup>
          <col style={{ width: 52 }} />
          <col style={{ width: showGroup ? '22%' : '26%' }} />
          {showGroup ? <col style={{ width: '14%' }} /> : null}
          <col style={{ width: 84 }} />
          <col />
          <col style={{ width: 170 }} />
          <col style={{ width: 150 }} />
        </colgroup>
        <Box component="thead">
          <Box component="tr">
            <PlainHeader />
            <SortHeader column={col('name', t('admin.hotels.col.hotel'))} state={sort} testId="admin-fleet-sort-name" />
            {showGroup ? <SortHeader column={col('group', t('admin.hotels.col.group'))} state={sort} testId="admin-fleet-sort-group" /> : null}
            <SortHeader column={col('rooms', t('admin.hotels.col.rooms'))} state={sort} align="right" testId="admin-fleet-sort-rooms" />
            <SortHeader column={col('modules', t('admin.hotels.col.modules'))} state={sort} testId="admin-fleet-sort-modules" />
            <SortHeader column={col('link', t('admin.hotels.col.link'))} state={sort} testId="admin-fleet-sort-link">
              <Help>{t('admin.hotels.help.link')}</Help>
            </SortHeader>
            <SortHeader column={col('state', t('admin.hotels.col.state'))} state={sort} testId="admin-fleet-sort-state">
              <Help>{t('admin.hotels.help.state')}</Help>
            </SortHeader>
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map((r) => (
            <Box
              component="tr"
              key={r.id}
              data-testid={`admin-fleet-row-${r.subdomain}`}
              {...drag(r.id)}
              sx={{
                bgcolor: selected.includes(r.id) ? accent.washSoft : undefined,
                opacity: r.is_active ? 1 : 0.62,
                '&:hover': { bgcolor: surface.s2 },
                '& td': { px: 1.25, py: 1.1, borderBottom: `1px solid ${surface.hair}`, verticalAlign: 'middle' },
              }}
            >
              <Box component="td">
                <Checkbox
                  size="small"
                  checked={selected.includes(r.id)}
                  onChange={() => onToggle(r.id)}
                  inputProps={{ 'aria-label': t('admin.hotels.pick', { name: r.name }), 'data-testid': `admin-fleet-pick-${r.subdomain}` } as Record<string, string>}
                />
              </Box>
              <Box component="td">
                <ButtonBase onClick={() => onOpen(r.id)} data-testid={`admin-fleet-open-${r.subdomain}`} sx={{ display: 'block', textAlign: 'left', borderRadius: `${shape.radiusSmall}px` }}>
                  <Box sx={{ fontWeight: 700, color: ink.hi }}><Hl text={r.name} q={q} /></Box>
                  <Box sx={{ ...typo.caption, color: ink.mid }}>
                    <Hl text={r.subdomain} q={q} />
                    {r.city ? <> · <Hl text={r.city} q={q} /></> : null}
                  </Box>
                </ButtonBase>
              </Box>
              {showGroup ? (
                <Box component="td" sx={{ color: r.group ? ink.hi : ink.low }}>
                  {r.group ? (
                    <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'center' }}>
                      <GroupMark color={r.group.color} size={10} />
                      <Hl text={r.group.title} q={q} />
                    </Box>
                  ) : (
                    t('admin.hotels.ungrouped.short')
                  )}
                </Box>
              ) : null}
              <Box component="td" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} data-testid={`admin-fleet-rooms-${r.subdomain}`}>{r.counts.rooms}</Box>
              <Box component="td"><ModulesCell codes={r.modules} /></Box>
              <Box component="td"><LinkCell kind={r.link} /></Box>
              <Box component="td"><StateCell row={r} /></Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
