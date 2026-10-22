import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';
import { useActionFailed } from '@/hooks/useActionFailed';
import { useRights } from '../../useRights';
import { accent, fieldSx, ink, panelSx, primaryButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../../adminTokens';
import {
  getGroupHistory,
  getGroupPage,
  getGroups,
  getHotelsView,
  moveHotels,
  patchGroup,
  setGroupDefaults,
  type GroupColor,
  type GroupHistoryRow,
  type HotelGroup,
  type HotelState,
  type HotelViewRow,
  type LinkKind,
} from '../../adminClient';
import { AddHotelsDialog, ColorPicker, DeleteGroupDialog, GroupActionDialog, useReadyModules } from './groupDialogs';
import { Dot, Empty, FilterBar, GroupMark, Help, Hl, Metric, Panel, Pill, useFacetValues, type Facet, type Tone } from './hotelsUi';

/**
 * СТРАНИЦА ГРУППЫ (партия 62-A2, по утверждённому макету) —
 * `?section=fleet&group=<id>&gtab=`. Вкладка в адресе: F5 и ссылка
 * открывают ту же. Сводка · Отели · Профиль · Действия · Умолчания · История.
 */

type GTab = 'summary' | 'hotels' | 'profile' | 'actions' | 'defaults' | 'history';
const TABS: GTab[] = ['summary', 'hotels', 'profile', 'actions', 'defaults', 'history'];
const LINK_TONE: Record<LinkKind, Tone> = { online: 'ok', silent: 'bad', none: 'muted' };
const STATE_TONE: Record<HotelState, Tone> = { problems: 'warn', ready: 'ok', disabled: 'muted' };
const stateOf = (row: HotelViewRow): HotelState => (!row.is_active ? 'disabled' : row.problems ? 'problems' : 'ready');
/** Фильтры вкладок: при смене вкладки сбрасываются. */
const TAB_KEYS = ['search', 'state', 'link', 'who', 'what', 'period'];

export function GroupPage({ id, onBack, onOpenHotel }: { id: string; onBack: () => void; onOpenHotel: (id: string) => void }) {
  const { t } = useTranslation();
  const { canWrite } = useRights();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('gtab') as GTab) ? params.get('gtab') : 'summary') as GTab;
  const page = useQuery({ queryKey: ['admin', 'fleet', 'group', id], queryFn: () => getGroupPage(id) });
  const [dialog, setDialog] = useState<null | 'add' | 'delete' | 'module' | 'disable' | 'enable'>(null);
  const all = useQuery({ queryKey: ['admin', 'fleet', 'all', 'everything'], queryFn: () => getHotelsView({ layout: 'list', origin: 'all' }) });

  const setTab = (next: GTab) => {
    const out = new URLSearchParams(params);
    out.set('gtab', next);
    for (const key of TAB_KEYS) out.delete(key);
    setParams(out, { replace: true });
  };

  return (
    <QueryState query={page} what={t('admin.groupPage.what')}>
      {(group) => (
        <Box data-testid="admin-group-page">
          <Button size="small" sx={{ color: accent.soft, mb: 1, px: 0.5 }} onClick={onBack} data-testid="admin-group-back">
            ← {t('admin.groupPage.back')}
          </Button>
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
              <Typography component="h1" sx={{ ...typo.pageTitle, color: ink.hi, display: 'flex', alignItems: 'center', gap: 1 }}>
                <GroupMark color={group.color} size={16} />
                {group.title}
              </Typography>
              <Typography sx={{ ...typo.body, color: ink.mid, mt: 0.5 }}>{group.description || t('admin.groupPage.noDescription')}</Typography>
            </Box>
            {canWrite ? (
              <Button sx={secondaryButtonSx} onClick={() => setDialog('add')} data-testid="admin-group-add-open">
                {t('admin.groupPage.addHotels')}
              </Button>
            ) : null}
          </Box>

          <Box role="tablist" sx={{ display: 'flex', gap: 0.5, overflowX: 'auto', borderBottom: `1px solid ${surface.line}`, mb: 1.5, mx: { xs: -2, md: 0 }, px: { xs: 2, md: 0 }, scrollbarWidth: 'none' }}>
            {TABS.map((key) => {
              const on = key === tab;
              const badge = key === 'hotels' ? group.summary.hotels : 0;
              return (
                <ButtonBase
                  key={key}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(key)}
                  data-testid={`admin-group-tab-${key}`}
                  sx={{ flex: '0 0 auto', px: 1.5, py: 1.25, gap: 0.75, ...typo.body, fontWeight: on ? 700 : 500, color: on ? ink.hi : ink.mid, borderBottom: `2px solid ${on ? accent.main : 'transparent'}`, mb: '-1px' }}
                >
                  {t(`admin.groupPage.tab.${key}`)}
                  {badge ? <Pill tone="muted">{badge}</Pill> : null}
                </ButtonBase>
              );
            })}
          </Box>
          <Typography sx={{ ...typo.body, color: ink.mid, mb: 2 }}>{t(`admin.groupPage.about.${tab}`)}</Typography>

          {tab === 'summary' ? <Summary group={group} onTab={setTab} /> : null}
          {tab === 'hotels' ? <Hotels group={group} canWrite={canWrite} onAdd={() => setDialog('add')} onOpenHotel={onOpenHotel} /> : null}
          {tab === 'profile' ? <Profile group={group} canWrite={canWrite} onDelete={() => setDialog('delete')} /> : null}
          {tab === 'actions' ? <Actions group={group} canWrite={canWrite} onOpen={setDialog} /> : null}
          {tab === 'defaults' ? <Defaults group={group} canWrite={canWrite} /> : null}
          {tab === 'history' ? <History id={group.id} /> : null}

          {dialog === 'add' ? <AddHotelsDialog group={group} rows={all.data?.items ?? []} onClose={() => setDialog(null)} /> : null}
          {dialog === 'delete' ? <DeleteGroupDialog group={group} rows={group.items} onClose={() => setDialog(null)} onDeleted={onBack} /> : null}
          {dialog === 'module' || dialog === 'disable' || dialog === 'enable' ? (
            <GroupActionDialog group={group} kind={dialog} onClose={() => setDialog(null)} />
          ) : null}
        </Box>
      )}
    </QueryState>
  );
}

type Page = HotelGroup & { summary: { hotels: number; active: number; rooms: number; problems: number; link: Record<LinkKind, number> }; modules: Record<string, number>; items: HotelViewRow[] };

/* ── Сводка ─────────────────────────────────────────────────────────────── */

function Summary({ group, onTab }: { group: Page; onTab: (tab: GTab) => void }) {
  const { t } = useTranslation();
  const ready = useReadyModules();
  const s = group.summary;
  if (!s.hotels) {
    return (
      <Box sx={panelSx}>
        <Empty title={t('admin.groupPage.summary.emptyTitle')} action={<Button sx={primaryButtonSx} onClick={() => onTab('hotels')}>{t('admin.groupPage.addHotels')}</Button>}>
          {t('admin.groupPage.summary.emptyBody')}
        </Empty>
      </Box>
    );
  }
  const dev = Object.keys(group.modules).filter((code) => !ready.includes(code));
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }} data-testid="admin-group-summary">
        <Metric label={t('admin.groupPage.summary.hotels')} value={s.hotels} hint={t('admin.groupPage.summary.active', { count: s.active })} />
        <Metric label={t('admin.groupPage.summary.rooms')} value={s.rooms} hint={t('admin.groupPage.summary.roomsHint')} />
        <Metric label={t('admin.groupPage.summary.problems')} value={s.problems} tone={s.problems ? 'warn' : 'ok'} hint={t('admin.groupPage.summary.problemsHint')} />
        <Metric
          label={t('admin.groupPage.summary.link')}
          value={t('admin.groupPage.summary.linkValue', { online: s.link.online, total: s.active })}
          tone={s.link.silent ? 'bad' : undefined}
          hint={t('admin.groupPage.summary.linkHint', { silent: s.link.silent, none: s.link.none })}
        />
      </Box>
      <Panel title={t('admin.groupPage.summary.modules')} aside={<Help>{t('admin.groupPage.summary.modulesHelp')}</Help>}>
        {ready.map((code) => {
          const on = group.modules[code] ?? 0;
          return (
            <Box key={code} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 80px', sm: '220px 1fr 80px' }, gap: 1.5, alignItems: 'center', py: 0.75, borderBottom: `1px solid ${surface.hair}` }} data-testid={`admin-group-module-${code}`}>
              <Box sx={{ ...typo.body, color: ink.hi, fontWeight: 600 }}>{t(`admin.module.${code}`)}</Box>
              <Box sx={{ display: { xs: 'none', sm: 'block' }, height: 8, borderRadius: 4, bgcolor: surface.s2, overflow: 'hidden' }}>
                <Box sx={{ width: `${(on / s.hotels) * 100}%`, height: '100%', bgcolor: accent.main }} />
              </Box>
              <Box sx={{ ...typo.caption, color: ink.mid, textAlign: 'right' }}>{t('admin.groupPage.summary.ofTotal', { on, total: s.hotels })}</Box>
            </Box>
          );
        })}
        {dev.length ? (
          <Typography sx={{ ...typo.caption, color: ink.mid, mt: 1.25 }}>
            {t('admin.groupPage.summary.devOn', { modules: dev.map((c) => t(`admin.module.${c}`)).join(', ') })}
          </Typography>
        ) : null}
      </Panel>
      {group.note ? (
        <Panel title={t('admin.hotels.group.note')}>
          <Box sx={{ ...typo.body, color: ink.hi, whiteSpace: 'pre-wrap' }}>{group.note}</Box>
        </Panel>
      ) : null}
    </Box>
  );
}

/* ── Отели ──────────────────────────────────────────────────────────────── */

function Hotels({ group, canWrite, onAdd, onOpenHotel }: { group: Page; canWrite: boolean; onAdd: () => void; onOpenHotel: (id: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const actionFailed = useActionFailed();
  const [params] = useSearchParams();
  const values = useFacetValues(['state', 'link']);
  const q = params.get('search') ?? '';
  const remove = useMutation({
    mutationFn: (hotelId: string) => moveHotels([hotelId], null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'groups'] });
    },
    onError: actionFailed,
  });
  const ql = q.toLowerCase();
  const shown = group.items.filter(
    (r) =>
      (!values.state.length || values.state.includes(stateOf(r))) &&
      (!values.link.length || values.link.includes(r.link)) &&
      (!ql || `${r.name} ${r.subdomain} ${r.city}`.toLowerCase().includes(ql)),
  );
  const facets: Facet[] = [
    { key: 'state', label: t('admin.hotels.filter.state'), options: (['problems', 'ready', 'disabled'] as HotelState[]).map((s) => ({ value: s, label: t(`admin.hotels.state.${s}`), tone: STATE_TONE[s] })) },
    { key: 'link', label: t('admin.hotels.filter.link'), options: (['online', 'silent', 'none'] as LinkKind[]).map((k) => ({ value: k, label: t(`admin.hotels.link.${k}`), tone: LINK_TONE[k] })) },
  ];
  return (
    <Box>
      <FilterBar facets={facets} placeholder={t('admin.groupPage.hotels.search')} aside={canWrite ? <Button sx={primaryButtonSx} onClick={onAdd}>{t('admin.groupPage.addHotels')}</Button> : undefined} />
      <Box sx={{ ...panelSx, p: 0 }}>
        {!group.items.length ? <Empty title={t('admin.groupPage.summary.emptyTitle')}>{t('admin.groupPage.hotels.emptyBody')}</Empty> : null}
        {group.items.length && !shown.length ? <Empty title={t('admin.hotels.empty.title')}>{t('admin.groupPage.hotels.noMatch')}</Empty> : null}
        {shown.map((r) => {
          const st = stateOf(r);
          return (
            <Box key={r.id} data-testid={`admin-group-hotel-${r.subdomain}`} sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', px: 2, py: 1.25, borderBottom: `1px solid ${surface.hair}`, opacity: r.is_active ? 1 : 0.62 }}>
              <ButtonBase onClick={() => onOpenHotel(r.id)} sx={{ flex: '1 1 220px', minWidth: 0, justifyContent: 'flex-start', textAlign: 'left' }}>
                <Box>
                  <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}><Hl text={r.name} q={q} /></Box>
                  <Box sx={{ ...typo.caption, color: ink.mid }}>
                    <Hl text={r.subdomain} q={q} /> · {t('admin.hotels.summary.rooms', { count: r.counts.rooms })}
                  </Box>
                </Box>
              </ButtonBase>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, ...typo.caption, color: ink.mid, whiteSpace: 'nowrap' }}>
                <Dot tone={LINK_TONE[r.link]} />
                {t(`admin.hotels.link.${r.link}`)}
              </Box>
              <Pill tone={STATE_TONE[st]}>{st === 'problems' ? t('admin.hotels.summary.problems', { count: r.problems }) : t(`admin.hotels.state.${st}`)}</Pill>
              {canWrite ? (
                <Button size="small" sx={{ color: ink.mid }} onClick={() => remove.mutate(r.id)} disabled={remove.isPending} data-testid={`admin-group-remove-${r.subdomain}`}>
                  {t('admin.groupPage.hotels.remove')}
                </Button>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Typography sx={{ ...typo.caption, color: ink.mid, mt: 1 }}>{t('admin.groupPage.hotels.removeHint')}</Typography>
    </Box>
  );
}

/* ── Профиль ────────────────────────────────────────────────────────────── */

function Row({ label, help, note, children }: { label: string; help?: string; note?: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '200px 1fr' }, gap: { xs: 0.5, sm: 2 }, py: 1.25, borderBottom: `1px solid ${surface.hair}` }}>
      <Typography sx={{ ...typo.caption, color: ink.mid, pt: { sm: 1 } }}>
        {label}
        {help ? <Help>{help}</Help> : null}
      </Typography>
      <Box sx={{ minWidth: 0 }}>
        {children}
        {note ? <Box sx={{ ...typo.caption, color: ink.low, mt: 0.5 }}>{note}</Box> : null}
      </Box>
    </Box>
  );
}

function Profile({ group, canWrite, onDelete }: { group: Page; canWrite: boolean; onDelete: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const actionFailed = useActionFailed();
  const groups = useQuery({ queryKey: ['admin', 'groups'], queryFn: getGroups });
  const save = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof patchGroup>[1] }) => patchGroup(id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'groups'] });
    },
    onError: actionFailed,
  });
  const ordered = [...(groups.data?.items ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'ru'));
  const index = ordered.findIndex((g) => g.id === group.id);
  const swap = (dir: -1 | 1) => {
    const other = ordered[index + dir];
    if (!other) return;
    // Порядок — обменом мест: у соседей одинаковый номер давал бы «прыжки».
    const mine = group.sort_order === other.sort_order ? other.sort_order + dir : other.sort_order;
    save.mutate({ id: group.id, patch: { sort_order: Math.max(0, mine) } });
    save.mutate({ id: other.id, patch: { sort_order: group.sort_order } });
  };
  const blur = (field: 'title' | 'description' | 'note') => (e: { target: { value: string } }) => {
    const value = field === 'title' ? e.target.value.trim() : e.target.value;
    if (value !== group[field] && (field !== 'title' || value)) save.mutate({ id: group.id, patch: { [field]: value } });
  };
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, alignItems: 'start' }}>
      <Panel title={t('admin.groupPage.profile.title')}>
        <Row label={t('admin.hotels.group.name')} help={t('admin.groupPage.profile.nameHelp')}>
          <TextField size="small" fullWidth disabled={!canWrite} defaultValue={group.title} onBlur={blur('title')} sx={fieldSx} inputProps={{ 'data-testid': 'admin-group-profile-title' }} />
        </Row>
        <Row label={t('admin.hotels.group.description')} help={t('admin.groupPage.profile.descriptionHelp')}>
          <TextField size="small" fullWidth multiline minRows={2} disabled={!canWrite} defaultValue={group.description} onBlur={blur('description')} sx={fieldSx} />
        </Row>
        <Row label={t('admin.hotels.group.note')} help={t('admin.hotels.group.noteHint')}>
          <TextField size="small" fullWidth multiline minRows={2} disabled={!canWrite} defaultValue={group.note} onBlur={blur('note')} sx={fieldSx} inputProps={{ 'data-testid': 'admin-group-profile-note' }} />
        </Row>
        <Row label={t('admin.hotels.group.color')} help={t('admin.groupPage.profile.colorHelp')}>
          <ColorPicker value={group.color} onChange={(color: GroupColor) => canWrite && save.mutate({ id: group.id, patch: { color } })} />
        </Row>
        <Row label={t('admin.groupPage.profile.order')} help={t('admin.groupPage.profile.orderHelp')} note={index >= 0 ? t('admin.groupPage.profile.position', { n: index + 1, total: ordered.length }) : undefined}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" sx={secondaryButtonSx} disabled={!canWrite || index <= 0} onClick={() => swap(-1)} data-testid="admin-group-order-up">↑ {t('admin.groupPage.profile.up')}</Button>
            <Button size="small" sx={secondaryButtonSx} disabled={!canWrite || index < 0 || index >= ordered.length - 1} onClick={() => swap(1)} data-testid="admin-group-order-down">↓ {t('admin.groupPage.profile.down')}</Button>
          </Box>
        </Row>
        <Row label={t('admin.groupPage.profile.parent')} help={t('admin.groupPage.profile.parentHelp')} note={t('admin.groupPage.profile.parentNote')}>
          <Box sx={{ ...typo.body, color: ink.low, pt: 0.5 }}>{t('admin.groupPage.profile.topLevel')}</Box>
        </Row>
        <Typography sx={{ ...typo.caption, color: ink.low, mt: 1 }}>{t('admin.groupPage.profile.autosave')}</Typography>
      </Panel>
      {canWrite ? (
        <Panel title={t('admin.groupPage.profile.deleteTitle')}>
          <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1.5 }}>{t('admin.hotels.delete.subtitle')}</Typography>
          <Button sx={{ ...secondaryButtonSx, color: state.bad, borderColor: state.bad }} onClick={onDelete} data-testid="admin-group-delete-open">
            {t('admin.groupPage.profile.delete')}
          </Button>
        </Panel>
      ) : null}
    </Box>
  );
}

/* ── Действия ───────────────────────────────────────────────────────────── */

function Actions({ group, canWrite, onOpen }: { group: Page; canWrite: boolean; onOpen: (d: 'module' | 'disable' | 'enable') => void }) {
  const { t } = useTranslation();
  const s = group.summary;
  const items: Array<{ key: 'module' | 'disable' | 'enable'; danger?: boolean; text: string }> = [
    { key: 'module', text: t('admin.groupPage.actions.moduleText', { count: s.hotels }) },
    { key: 'disable', danger: true, text: t('admin.groupPage.actions.disableText', { count: s.active }) },
    { key: 'enable', text: t('admin.groupPage.actions.enableText', { count: s.hotels - s.active }) },
  ];
  return (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
      {items.map((it) => (
        <Box key={it.key} sx={{ ...panelSx, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography sx={{ ...typo.panelTitle, color: it.danger ? state.bad : ink.hi }}>{t(`admin.groupPage.actions.${it.key}`)}</Typography>
          <Typography sx={{ ...typo.body, color: ink.mid, flex: 1 }}>{it.text}</Typography>
          <Button
            sx={it.danger ? { ...secondaryButtonSx, color: state.bad, borderColor: state.bad } : secondaryButtonSx}
            disabled={!canWrite || !s.hotels}
            onClick={() => onOpen(it.key)}
            data-testid={`admin-group-action-open-${it.key}`}
          >
            {t(`admin.groupPage.actions.${it.key}Button`)}
          </Button>
        </Box>
      ))}
      <Typography sx={{ ...typo.caption, color: ink.mid, gridColumn: '1 / -1' }}>{t('admin.groupPage.actions.journal')}</Typography>
    </Box>
  );
}

/* ── Умолчания ──────────────────────────────────────────────────────────── */

function Defaults({ group, canWrite }: { group: Page; canWrite: boolean }) {
  const { t } = useTranslation();
  const ready = useReadyModules();
  const qc = useQueryClient();
  const actionFailed = useActionFailed();
  const save = useMutation({
    mutationFn: ({ enabled, modules }: { enabled: boolean; modules: string[] }) => setGroupDefaults(group.id, enabled, modules),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'fleet', 'group', group.id] }),
    onError: actionFailed,
  });
  const modules = group.auto_modules;
  const toggle = (code: string) => save.mutate({ enabled: group.auto_enabled, modules: modules.includes(code) ? modules.filter((c) => c !== code) : [...modules, code] });
  const names = modules.map((c) => t(`admin.module.${c}`)).join(', ');
  return (
    <Panel title={t('admin.groupPage.defaults.title')}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.25, mb: 1.5, borderRadius: `${shape.radius}px`, bgcolor: group.auto_enabled ? accent.washSoft : surface.s2, border: `1px solid ${group.auto_enabled ? accent.main : surface.line}` }}>
        <Switch
          checked={group.auto_enabled}
          disabled={!canWrite || save.isPending}
          onChange={() => save.mutate({ enabled: !group.auto_enabled, modules })}
          inputProps={{ 'aria-label': t('admin.groupPage.defaults.switch'), 'data-testid': 'admin-group-defaults-switch' } as Record<string, string>}
        />
        <Box sx={{ ...typo.body, color: ink.hi, fontWeight: 600 }} data-testid="admin-group-defaults-state">
          {group.auto_enabled
            ? modules.length
              ? t('admin.groupPage.defaults.on', { modules: names })
              : t('admin.groupPage.defaults.onEmpty')
            : t('admin.groupPage.defaults.off')}
        </Box>
      </Box>
      {ready.map((code) => (
        <ButtonBase
          key={code}
          onClick={() => toggle(code)}
          disabled={!canWrite || !group.auto_enabled || save.isPending}
          data-testid={`admin-group-defaults-${code}`}
          sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', gap: 1, py: 0.5, textAlign: 'left', opacity: group.auto_enabled ? 1 : 0.5 }}
        >
          <Checkbox size="small" checked={modules.includes(code)} tabIndex={-1} />
          <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{t(`admin.module.${code}`)}</Box>
        </ButtonBase>
      ))}
      <Box sx={{ mt: 1.5, display: 'grid', gap: 0.5, ...typo.caption, color: ink.mid }}>
        <span>• {t('admin.groupPage.defaults.note1')}</span>
        <span>• {t('admin.groupPage.defaults.note2')}</span>
        <span>• {t('admin.groupPage.defaults.note3')}</span>
      </Box>
    </Panel>
  );
}

/* ── История ────────────────────────────────────────────────────────────── */

type Kind = 'created' | 'updated' | 'hotels' | 'action' | 'defaults' | 'deleted';
const KIND: Record<string, Kind> = {
  'platform.group.created': 'created',
  'platform.group.updated': 'updated',
  'platform.group.hotels_moved': 'hotels',
  'platform.group.action': 'action',
  'platform.group.defaults_set': 'defaults',
  'platform.group.deleted': 'deleted',
};

interface Line {
  what: string;
  from?: string;
  to?: string;
  text?: string;
}

function useDescribe() {
  const { t } = useTranslation();
  const module = (code: unknown) => t(`admin.module.${String(code)}`);
  const value = (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (field === 'color') return t(`admin.hotels.color.${String(v)}`);
    if (field === 'auto_enabled') return v ? t('admin.groupPage.history.on') : t('admin.groupPage.history.off');
    if (field === 'auto_modules') return (v as string[]).length ? (v as string[]).map(module).join(', ') : '—';
    if (field === 'parent') return v ? t('admin.groupPage.history.someGroup') : t('admin.groupPage.profile.topLevel');
    return String(v);
  };
  return (row: GroupHistoryRow): Line[] => {
    const p = row.payload as Record<string, unknown>;
    const kind = KIND[row.action];
    if (kind === 'updated' || kind === 'defaults') {
      return Object.entries((p.changes ?? {}) as Record<string, { from: unknown; to: unknown }>).map(([field, c]) => ({
        what: t(`admin.groupPage.history.field.${field}`),
        from: value(field, c.from),
        to: value(field, c.to),
      }));
    }
    if (kind === 'hotels') {
      return ((p.moves ?? []) as Array<Record<string, unknown>>).map((m) => ({
        what: String(m.hotel || '—'),
        from: String(m.from || t('admin.hotels.ungrouped.short')),
        to: String(m.to || t('admin.hotels.ungrouped.short')),
        text: (m.modules_enabled as string[] | undefined)?.length
          ? t('admin.groupPage.history.modulesOn', { modules: (m.modules_enabled as string[]).map(module).join(', ') })
          : undefined,
      }));
    }
    if (kind === 'action') {
      const changed = (p.changed as string[]) ?? [];
      const what = p.module ? t(`admin.groupPage.history.action.${String(p.kind)}`, { module: module(p.module) }) : t(`admin.groupPage.history.action.${String(p.kind)}`, { module: '' });
      return [{ what, text: `${t('admin.groupPage.history.changed', { count: changed.length })}${changed.length ? `: ${changed.join(', ')}` : ''}${p.reason ? ` · ${t('admin.groupPage.history.reason', { reason: String(p.reason) })}` : ''}` }];
    }
    if (kind === 'created') {
      // До партии 62-A2 запись создания хранила число отелей, а не список.
      if (typeof p.hotels === 'number') {
        return [{ what: t('admin.groupPage.history.createdWhat'), text: p.hotels ? t('admin.groupPage.history.createdCount', { count: p.hotels }) : t('admin.groupPage.history.createdEmpty') }];
      }
      const hotels = Array.isArray(p.hotels) ? (p.hotels as string[]) : [];
      return [{ what: t('admin.groupPage.history.createdWhat'), text: hotels.length ? t('admin.groupPage.history.createdWith', { hotels: hotels.join(', ') }) : t('admin.groupPage.history.createdEmpty') }];
    }
    return [{ what: t('admin.groupPage.history.deletedWhat') }];
  };
}

const PERIODS: Array<[string, number]> = [['day', 1], ['week', 7], ['month', 30]];

function History({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const history = useQuery({ queryKey: ['admin', 'fleet', 'group', id, 'history'], queryFn: () => getGroupHistory(id) });
  const describe = useDescribe();
  const values = useFacetValues(['who', 'what', 'period']);
  const q = (params.get('search') ?? '').toLowerCase();
  const rows = (history.data?.items ?? []).map((row) => ({ row, kind: KIND[row.action] ?? 'updated', lines: describe(row) }));
  const actors = [...new Set(rows.map((r) => r.row.actor).filter(Boolean))];
  const days = PERIODS.find(([k]) => k === values.period[0])?.[1];
  const since = days ? Date.now() - days * 86_400_000 : 0;
  const shown = rows.filter(
    (r) =>
      (!values.who.length || values.who.includes(r.row.actor)) &&
      (!values.what.length || values.what.includes(r.kind)) &&
      Date.parse(r.row.at) >= since &&
      (!q || [r.row.actor, ...r.lines.flatMap((l) => [l.what, l.from, l.to, l.text])].some((s) => s?.toLowerCase().includes(q))),
  );
  const facets: Facet[] = [
    { key: 'who', label: t('admin.groupPage.history.who'), options: actors.map((a) => ({ value: a, label: a })) },
    { key: 'what', label: t('admin.groupPage.history.what'), options: (['created', 'updated', 'hotels', 'action', 'defaults'] as Kind[]).map((k) => ({ value: k, label: t(`admin.groupPage.history.kind.${k}`), count: rows.filter((r) => r.kind === k).length })) },
    { key: 'period', label: t('admin.groupPage.history.period'), options: PERIODS.map(([k]) => ({ value: k, label: t(`admin.groupPage.history.periods.${k}`) })) },
  ];
  const at = (iso: string) => new Date(iso).toLocaleString(i18n.language, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return (
    <Box>
      <FilterBar facets={facets} placeholder={t('admin.groupPage.history.search')} />
      <Box sx={{ ...panelSx, p: 0 }} data-testid="admin-group-history">
        {history.isPending ? <Box sx={{ p: 2, ...typo.body, color: ink.mid }}>{t('admin.groupPage.loading')}</Box> : null}
        {!history.isPending && !shown.length ? (
          <Empty title={rows.length ? t('admin.groupPage.history.noMatch') : t('admin.groupPage.history.emptyTitle')}>
            {rows.length ? t('admin.groupPage.history.noMatchBody') : t('admin.groupPage.history.emptyBody')}
          </Empty>
        ) : null}
        {shown.map(({ row, kind, lines }) => (
          <Box key={row.id} data-testid="admin-group-history-row" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '190px 150px 1fr' }, gap: { xs: 0.25, md: 2 }, px: 2, py: 1.25, borderBottom: `1px solid ${surface.hair}` }}>
            <Box sx={{ ...typo.caption, color: ink.mid }}>
              {at(row.at)}
              <Box sx={{ color: ink.low, overflowWrap: 'anywhere' }}>{row.actor || t('admin.groupPage.history.system')}</Box>
            </Box>
            <Box><Pill tone="muted">{t(`admin.groupPage.history.kind.${kind}`)}</Pill></Box>
            <Box sx={{ display: 'grid', gap: 0.25, minWidth: 0 }}>
              {lines.map((l, i) => (
                <Box key={i} sx={{ ...typo.body, color: ink.hi, overflowWrap: 'anywhere' }}>
                  <Box component="span" sx={{ fontWeight: 700 }}>{l.what}{l.from !== undefined || l.text ? ': ' : ''}</Box>
                  {l.from !== undefined ? (
                    <>
                      <Box component="span" sx={{ color: ink.mid, textDecoration: 'line-through' }}>{l.from}</Box>
                      {' → '}
                      <span>{l.to}</span>
                      {l.text ? <Box component="span" sx={{ color: ink.mid }}> · {l.text}</Box> : null}
                    </>
                  ) : l.text ? (
                    <Box component="span" sx={{ color: ink.mid }}>{l.text}</Box>
                  ) : null}
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
