import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import SearchIcon from '@mui/icons-material/Search';

import { accent, fieldSx, ink, panelSx, primaryButtonSx, secondaryButtonSx, shape, surface, typo } from '../adminTokens';
import { AdminDialog } from '../form';
import type { Go } from './SandboxApp';
import { useFleetLines, type HotelLine } from './sandboxData';
import { MODULES } from './moduleCatalog';
import { SILENT_AFTER_S, plural, quickProblems, type Problem } from './readiness';
import { AddressTabs, Dot, FilterChip, PageHead, Panel, Pill, Sample, type Tone } from './ui';

/**
 * МАКЕТ 1 — «ОТЕЛИ» (партия 62): реестр и вкладка «Сети».
 *
 * Колонки — то, ради чего открывают реестр: где проблемы и что включено.
 * Тарифа нет (решение Олега), номера — живые (профиль, а не реестр: реестр
 * сегодня считает и удалённые — «Кристалл» 56133 вместо 9).
 */

/** Сетей у платформы нет — образец: демо-отели в одной сети. */
const SAMPLE_NETWORK = 'NaviRoom Демо';
const SAMPLE_MEMBERS = new Set(['crystal', 'lumen', 'azure']);

type Link = { tone: Tone; label: string; offline: boolean };

function linkOf(line: HotelLine): Link {
  const live = line.nodes.filter((n) => !n.is_revoked);
  if (!live.length) return { tone: 'muted', label: 'нет коннектора', offline: false };
  const silent = live.filter((n) => n.seconds_since_seen == null || n.seconds_since_seen > SILENT_AFTER_S);
  if (silent.length) return { tone: 'bad', label: 'не на связи', offline: true };
  return { tone: 'ok', label: 'на связи', offline: false };
}

interface View {
  line: HotelLine;
  name: string;
  rooms: number;
  network: string | null;
  link: Link;
  problems: Problem[];
  modulesOn: string[];
}

const FILTERS = [
  { key: 'problems', label: 'Есть проблемы', tone: 'warn' as Tone },
  { key: 'offline', label: 'Коннектор не на связи', tone: 'bad' as Tone },
  { key: 'network', label: 'В сети', tone: undefined },
  { key: 'disabled', label: 'Отключённые', tone: 'muted' as Tone },
];

export function FleetMock({ go }: { go: Go }) {
  const [params] = useSearchParams();
  const tab = params.get('view') === 'networks' ? 'networks' : 'hotels';
  const filters = new Set((params.get('f') ?? '').split(',').filter(Boolean));
  const moduleFilter = params.get('m');
  const search = params.get('q') ?? '';
  const narrow = useMediaQuery('(max-width:899px)');
  const { lines, ready } = useFleetLines();
  const [selected, setSelected] = useState<string[]>(() =>
    params.get('sel') === 'demo' ? ['crystal', 'lumen', 'azure'] : [],
  );
  const [dialog, setDialog] = useState<string | null>(params.get('dialog'));

  const views: View[] = useMemo(
    () =>
      lines.map((line) => ({
        line,
        name: line.profile?.name ?? line.row.name,
        rooms: line.profile?.counts.rooms ?? 0,
        network: SAMPLE_MEMBERS.has(line.row.subdomain) ? SAMPLE_NETWORK : null,
        link: linkOf(line),
        problems: line.row.is_active ? quickProblems(line.modules, line.nodes, line.admins) : [],
        modulesOn: line.modules.filter((m) => m.is_enabled).map((m) => m.code),
      })),
    [lines],
  );

  // Сначала то, что требует рук: отели с проблемами, потом остальные
  // работающие, отключённые — в конце.
  const rank = (v: View) => (!v.line.row.is_active ? 2 : v.problems.length ? 0 : 1);
  const shown = [...views].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ru')).filter((v) => {
    if (search && !`${v.name} ${v.line.row.subdomain} ${v.line.profile?.city ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filters.has('problems') && !v.problems.length) return false;
    if (filters.has('offline') && !v.link.offline) return false;
    if (filters.has('network') && !v.network) return false;
    if (filters.has('disabled') ? v.line.row.is_active : false) return false;
    if (moduleFilter && !v.modulesOn.includes(moduleFilter)) return false;
    return true;
  });

  const counts = {
    problems: views.filter((v) => v.problems.length).length,
    offline: views.filter((v) => v.link.offline).length,
    network: views.filter((v) => v.network).length,
    disabled: views.filter((v) => !v.line.row.is_active).length,
  };

  const toggleFilter = (key: string) => {
    const next = new Set(filters);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    go({ f: [...next].join(',') || null }, true);
  };
  const toggle = (sub: string) =>
    setSelected((cur) => (cur.includes(sub) ? cur.filter((s) => s !== sub) : [...cur, sub]));

  return (
    <Box>
      <PageHead
        title="Отели"
        subtitle={ready ? `${views.length} ${plural(views.length, 'отель', 'отеля', 'отелей')}, из них с проблемами — ${counts.problems}` : 'Загружаем…'}
        actions={<Button sx={primaryButtonSx}>+ Новый отель</Button>}
      />
      <AddressTabs
        tabs={[
          { key: 'hotels', label: 'Отели', badge: views.length },
          { key: 'networks', label: 'Сети', badge: 1 },
        ]}
        active={tab}
        onChange={(key) => go({ view: key === 'hotels' ? null : key }, true)}
      />

      {tab === 'networks' ? (
        <Networks views={views} narrow={narrow} go={go} />
      ) : (
        <>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
            <TextField
              size="small"
              placeholder="Название, поддомен или город"
              defaultValue={search}
              onChange={(e) => go({ q: e.target.value || null }, true)}
              sx={{ ...fieldSx, width: { xs: '100%', md: 300 } }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
            />
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: { xs: 'nowrap', md: 'wrap' }, overflowX: 'auto', maxWidth: '100%', pb: { xs: 0.5, md: 0 } }}>
              {FILTERS.map((f) => (
                <FilterChip
                  key={f.key}
                  active={filters.has(f.key)}
                  label={f.label}
                  count={counts[f.key as keyof typeof counts]}
                  tone={f.tone}
                  onClick={() => toggleFilter(f.key)}
                />
              ))}
              <FilterChip
                active={Boolean(moduleFilter)}
                label={moduleFilter ? `Модуль: ${MODULES.find((m) => m.code === moduleFilter)?.title}` : 'Модуль ▾'}
                onClick={() => go({ m: moduleFilter ? null : 'room_control' }, true)}
              />
            </Box>
          </Box>

          {selected.length ? (
            <Box
              data-testid="sandbox-bulkbar"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                flexWrap: 'wrap',
                mb: 1.5,
                p: 1.25,
                borderRadius: `${shape.radiusLarge}px`,
                bgcolor: accent.washSoft,
                border: `1px solid ${accent.main}`,
              }}
            >
              <Typography sx={{ ...typo.caption, fontWeight: 700, color: accent.soft, mr: 1 }}>
                Выбрано {selected.length}
              </Typography>
              <Button size="small" sx={secondaryButtonSx}>Включить модуль…</Button>
              <Button size="small" sx={secondaryButtonSx}>В сеть…</Button>
              <Button size="small" sx={secondaryButtonSx}>Выгрузить</Button>
              <Button size="small" sx={secondaryButtonSx} onClick={() => setDialog('bulk-disable')}>Отключить…</Button>
              <Button size="small" sx={{ ml: 'auto', color: ink.mid }} onClick={() => setSelected([])}>Снять выбор</Button>
            </Box>
          ) : null}

          {narrow ? (
            <Box sx={{ display: 'grid', gap: 1 }}>
              {shown.map((v) => (
                <HotelCard key={v.line.row.id} v={v} checked={selected.includes(v.line.row.subdomain)} onToggle={() => toggle(v.line.row.subdomain)} onOpen={() => go({ hotel: v.line.row.id, tab: 'overview' })} />
              ))}
            </Box>
          ) : (
            <HotelTable
              views={shown}
              selected={selected}
              onToggle={toggle}
              onToggleAll={() => setSelected(selected.length === shown.length ? [] : shown.map((v) => v.line.row.subdomain))}
              onOpen={(id) => go({ hotel: id, tab: 'overview' })}
            />
          )}
          {ready && !shown.length ? (
            <Panel><Box sx={{ ...typo.body, color: ink.mid }}>Под фильтр не попал ни один отель.</Box></Panel>
          ) : null}
        </>
      )}

      {dialog === 'bulk-disable' ? (
        <AdminDialog
          testId="sandbox-bulk-disable"
          title={`Отключить ${selected.length || 3} ${plural(selected.length || 3, 'отель', 'отеля', 'отелей')}?`}
          subtitle="Гости увидят «Отель временно недоступен», персонал выйдет из панели. Данные и настройки сохранятся."
          onClose={() => setDialog(null)}
          actions={
            <>
              <Button sx={{ color: ink.mid }} onClick={() => setDialog(null)}>Отмена</Button>
              <Button sx={primaryButtonSx} disabled>Отключить</Button>
            </>
          }
        >
          <TextField label="Причина (обязательно)" multiline minRows={2} fullWidth sx={fieldSx} />
        </AdminDialog>
      ) : null}
    </Box>
  );
}

function ModulesCell({ codes }: { codes: string[] }) {
  if (!codes.length) return <Box component="span" sx={{ color: ink.low }}>—</Box>;
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {codes.map((code) => {
        const m = MODULES.find((x) => x.code === code);
        return <Pill key={code} tone={m?.status === 'ready' ? 'info' : 'muted'}>{m?.title ?? code}</Pill>;
      })}
    </Box>
  );
}

function StateCell({ v }: { v: View }) {
  if (!v.line.row.is_active) return <Pill tone="muted">отключён</Pill>;
  if (!v.problems.length) return <Pill tone="ok">готов</Pill>;
  const bad = v.problems.some((p) => p.severity === 'bad');
  return (
    <Pill tone={bad ? 'bad' : 'warn'}>
      {v.problems.length} {plural(v.problems.length, 'проблема', 'проблемы', 'проблем')}
    </Pill>
  );
}

function Th({ children, align }: { children?: ReactNode; align?: 'right' }) {
  return (
    <Box component="th" sx={{ ...typo.label, color: ink.mid, textAlign: align ?? 'left', px: 1.25, py: 1.25, borderBottom: `1px solid ${surface.line}`, whiteSpace: 'nowrap' }}>
      {children}
    </Box>
  );
}

function HotelTable({
  views,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
}: {
  views: View[];
  selected: string[];
  onToggle: (sub: string) => void;
  onToggleAll: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <Box sx={{ ...panelSx, p: 0, overflowX: 'auto' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', ...typo.body }}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" sx={{ width: 44, borderBottom: `1px solid ${surface.line}` }}>
              <Checkbox size="small" checked={Boolean(views.length) && selected.length === views.length} indeterminate={Boolean(selected.length) && selected.length < views.length} onChange={onToggleAll} />
            </Box>
            <Th>Отель</Th>
            <Th><Box sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'center' }}>Сеть <Sample /></Box></Th>
            <Th align="right">Номера</Th>
            <Th>Модули</Th>
            <Th>Связь</Th>
            <Th>Состояние</Th>
          </Box>
        </Box>
        <Box component="tbody">
          {views.map((v) => {
            const sub = v.line.row.subdomain;
            return (
              <Box
                component="tr"
                key={v.line.row.id}
                onClick={() => onOpen(v.line.row.id)}
                sx={{
                  cursor: 'pointer',
                  bgcolor: selected.includes(sub) ? accent.washSoft : undefined,
                  opacity: v.line.row.is_active ? 1 : 0.62,
                  '&:hover': { bgcolor: surface.s2 },
                  '& td': { px: 1.25, py: 1.1, borderBottom: `1px solid ${surface.hair}`, verticalAlign: 'middle' },
                }}
              >
                <Box component="td" onClick={(e) => e.stopPropagation()}>
                  <Checkbox size="small" checked={selected.includes(sub)} onChange={() => onToggle(sub)} />
                </Box>
                <Box component="td">
                  <Box sx={{ fontWeight: 700, color: ink.hi }}>{v.name}</Box>
                  <Box sx={{ ...typo.caption, color: ink.mid }}>
                    {sub}
                    {v.line.profile?.city ? ` · ${v.line.profile.city}` : ''}
                  </Box>
                </Box>
                <Box component="td" sx={{ color: v.network ? ink.hi : ink.low }}>{v.network ?? '—'}</Box>
                <Box component="td" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.rooms}</Box>
                <Box component="td"><ModulesCell codes={v.modulesOn} /></Box>
                <Box component="td">
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, whiteSpace: 'nowrap', color: v.link.tone === 'muted' ? ink.low : ink.hi }}>
                    <Dot tone={v.link.tone} />
                    {v.link.label}
                  </Box>
                </Box>
                <Box component="td"><StateCell v={v} /></Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

function HotelCard({ v, checked, onToggle, onOpen }: { v: View; checked: boolean; onToggle: () => void; onOpen: () => void }) {
  return (
    <Box sx={{ ...panelSx, p: 1.5, display: 'flex', gap: 1, opacity: v.line.row.is_active ? 1 : 0.62, outline: checked ? `2px solid ${accent.main}` : 'none' }}>
      <Checkbox size="small" checked={checked} onChange={onToggle} sx={{ alignSelf: 'flex-start', m: -0.75 }} />
      <ButtonBase onClick={onOpen} sx={{ flex: 1, minWidth: 0, display: 'block', textAlign: 'left' }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{v.name}</Box>
            <Box sx={{ ...typo.caption, color: ink.mid }}>
              {v.line.row.subdomain} · {v.rooms} {plural(v.rooms, 'номер', 'номера', 'номеров')}
              {v.network ? ` · ${v.network}` : ''}
            </Box>
          </Box>
          <StateCell v={v} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1, ...typo.caption, color: ink.mid }}>
          <Dot tone={v.link.tone} /> {v.link.label}
        </Box>
        {v.modulesOn.length ? <Box sx={{ mt: 1 }}><ModulesCell codes={v.modulesOn} /></Box> : null}
      </ButtonBase>
    </Box>
  );
}

function Networks({ views, narrow, go }: { views: View[]; narrow: boolean; go: Go }) {
  const members = views.filter((v) => v.network === SAMPLE_NETWORK);
  const loose = views.filter((v) => !v.network);
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: narrow ? '1fr' : '1fr 1fr', alignItems: 'start' }}>
      <Panel
        title={SAMPLE_NETWORK}
        aside={<Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}><Sample /><Button size="small" sx={secondaryButtonSx}>Изменить</Button></Box>}
      >
        <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1 }}>
          Сеть — это владелец нескольких отелей: общий администратор, общие справочники, сводка по сети. {members.length} {plural(members.length, 'отель', 'отеля', 'отелей')}.
        </Typography>
        {members.map((v) => (
          <ButtonBase key={v.line.row.id} onClick={() => go({ view: null, hotel: v.line.row.id, tab: 'overview' })} sx={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 1, py: 1, borderTop: `1px solid ${surface.hair}`, textAlign: 'left' }}>
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{v.name}</Box>
              <Box sx={{ ...typo.caption, color: ink.mid }}>{v.line.profile?.city} · {v.rooms} {plural(v.rooms, 'номер', 'номера', 'номеров')}</Box>
            </Box>
            <StateCell v={v} />
          </ButtonBase>
        ))}
      </Panel>
      <Panel title="Без сети" aside={<Button size="small" sx={primaryButtonSx}>+ Новая сеть</Button>}>
        <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1 }}>
          Отдельные отели. Выберите их в списке «Отели» и нажмите «В сеть…».
        </Typography>
        {loose.map((v) => (
          <Box key={v.line.row.id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 1, borderTop: `1px solid ${surface.hair}` }}>
            <Box sx={{ ...typo.body, color: v.line.row.is_active ? ink.hi : ink.low, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</Box>
            <StateCell v={v} />
          </Box>
        ))}
      </Panel>
    </Box>
  );
}
