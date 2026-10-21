import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Radio from '@mui/material/Radio';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';

import { accent, fieldSx, ink, panelSx, primaryButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../adminTokens';
import { AdminDialog } from '../form';
import type { Go } from './SandboxApp';
import { useFleetLines, type HotelLine } from './sandboxData';
import { MODULES } from './moduleCatalog';
import { SILENT_AFTER_S, plural, quickProblems, type Problem } from './readiness';
import { FilterBar, passes, useFilters, type Facet } from './FilterBar';
import { Dot, Empty, Help, Hl, PageHead, Pill, Sample, ViewSwitch, type Tone } from './ui';

/**
 * МАКЕТ 1 — «ОТЕЛИ» (партия 62, второй заход): один экран вместо «Отели |
 * Сети». Группа — владелец нескольких отелей; слово «сеть» ушло. Сверху —
 * группы раскрывающимися блоками с их отелями, ниже — «Отели без группы».
 *
 * Групп у платформы локально нет ни одной, поэтому состав — образец, и
 * правки (создать, переименовать, перенести) живут в памяти экрана.
 */

interface Group {
  id: string;
  title: string;
  hotels: string[];
}

const SAMPLE_GROUPS: Group[] = [
  { id: 'g-demo', title: 'Демо-отели', hotels: ['crystal', 'azure'] },
  { id: 'g-spb', title: 'Санкт-Петербург', hotels: ['lumen'] },
];

type LinkKind = 'online' | 'silent' | 'none';
const LINK: Record<LinkKind, { tone: Tone; label: string }> = {
  online: { tone: 'ok', label: 'на связи' },
  silent: { tone: 'bad', label: 'не на связи' },
  none: { tone: 'muted', label: 'нет коннектора' },
};
type StateKind = 'problems' | 'ready' | 'disabled';

function linkOf(line: HotelLine): LinkKind {
  const live = line.nodes.filter((n) => !n.is_revoked);
  if (!live.length) return 'none';
  return live.some((n) => n.seconds_since_seen == null || n.seconds_since_seen > SILENT_AFTER_S) ? 'silent' : 'online';
}

interface View {
  line: HotelLine;
  sub: string;
  name: string;
  city: string;
  rooms: number;
  group: Group | null;
  link: LinkKind;
  state: StateKind;
  problems: Problem[];
  modulesOn: string[];
}

const KEYS = ['state', 'link', 'module', 'group'];

export function FleetMock({ go }: { go: Go }) {
  const [params] = useSearchParams();
  const layout = params.get('layout') === 'list' ? 'list' : 'groups';
  const closed = new Set((params.get('closed') ?? '').split(',').filter(Boolean));
  const { q, values } = useFilters(KEYS);
  const narrow = useMediaQuery('(max-width:899px)');
  const { lines, ready } = useFleetLines();
  const [groups, setGroups] = useState<Group[]>(SAMPLE_GROUPS);
  const [selected, setSelected] = useState<string[]>(() => (params.get('sel') === 'demo' ? ['lumen', 'azure'] : []));
  const [dialog, setDialog] = useState<string | null>(params.get('dialog'));
  const [renaming, setRenaming] = useState<Group | null>(null);

  const views: View[] = useMemo(
    () =>
      lines.map((line) => {
        const problems = line.row.is_active ? quickProblems(line.modules, line.nodes, line.admins) : [];
        const view: View = {
          line,
          sub: line.row.subdomain,
          name: line.profile?.name ?? line.row.name,
          city: line.profile?.city ?? '',
          rooms: line.profile?.counts.rooms ?? 0,
          group: groups.find((g) => g.hotels.includes(line.row.subdomain)) ?? null,
          link: linkOf(line),
          state: !line.row.is_active ? 'disabled' : problems.length ? 'problems' : 'ready',
          problems,
          modulesOn: line.modules.filter((m) => m.is_enabled).map((m) => m.code),
        };
        return view;
      }),
    [lines, groups],
  );

  const ql = q.toLowerCase();
  const hotelHit = (v: View) => !ql || [v.name, v.sub, v.city].some((s) => s.toLowerCase().includes(ql));
  const groupHit = (g: Group) => Boolean(ql) && g.title.toLowerCase().includes(ql);
  const filtered = (v: View) =>
    passes(values.state, v.state) &&
    passes(values.link, v.link) &&
    passes(values.module, v.modulesOn) &&
    passes(values.group, v.group?.id ?? 'none');
  // Найденная группа показывает все свои отели; найденный отель — только себя.
  const visible = (v: View) => filtered(v) && (hotelHit(v) || (v.group ? groupHit(v.group) : false));
  const rank = (v: View) => (v.state === 'disabled' ? 2 : v.state === 'problems' ? 0 : 1);
  const sorted = [...views].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ru'));
  const shown = sorted.filter(visible);

  const count = (pred: (v: View) => boolean) => views.filter(pred).length;
  const facets: Facet[] = [
    {
      key: 'state',
      label: 'Состояние',
      options: [
        { value: 'problems', label: 'Есть проблемы', tone: 'warn', count: count((v) => v.state === 'problems') },
        { value: 'ready', label: 'Готов', tone: 'ok', count: count((v) => v.state === 'ready') },
        { value: 'disabled', label: 'Отключён', tone: 'muted', count: count((v) => v.state === 'disabled') },
      ],
    },
    {
      key: 'link',
      label: 'Связь',
      options: (['online', 'silent', 'none'] as LinkKind[]).map((k) => ({ value: k, label: LINK[k].label, tone: LINK[k].tone, count: count((v) => v.link === k) })),
    },
    {
      key: 'module',
      label: 'Модуль',
      options: MODULES.map((m) => ({ value: m.code, label: m.title, count: count((v) => v.modulesOn.includes(m.code)) })),
    },
    {
      key: 'group',
      label: 'Группа',
      options: [
        ...groups.map((g) => ({ value: g.id, label: g.title, count: count((v) => v.group?.id === g.id) })),
        { value: 'none', label: 'Без группы', count: count((v) => !v.group) },
      ],
    },
  ];

  const toggle = (sub: string) => setSelected((cur) => (cur.includes(sub) ? cur.filter((s) => s !== sub) : [...cur, sub]));
  const moveTo = (subs: string[], groupId: string | null) =>
    setGroups((cur) =>
      cur.map((g) => ({
        ...g,
        hotels: g.id === groupId ? [...new Set([...g.hotels, ...subs])] : g.hotels.filter((h) => !subs.includes(h)),
      })),
    );
  const setClosed = (id: string) => {
    const next = new Set(closed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    go({ closed: [...next].join(',') || null }, true);
  };

  const tableProps = { selected, onToggle: toggle, q, onOpen: (id: string) => go({ hotel: id, tab: 'overview' }), narrow };
  const searching = Boolean(q) || KEYS.some((k) => values[k].size);

  return (
    <Box>
      <PageHead
        title="Отели"
        subtitle="Все отели платформы. Группа объединяет отели одного владельца: у них общий администратор, общие справочники и сводка. Откройте отель, чтобы увидеть, что ему мешает, или выберите несколько — и действуйте сразу над всеми."
        actions={
          <>
            <Button sx={secondaryButtonSx} onClick={() => setDialog('new-group')}>+ Новая группа</Button>
            <Button sx={primaryButtonSx}>+ Новый отель</Button>
          </>
        }
      />

      <FilterBar
        facets={facets}
        go={go}
        placeholder="Отель, поддомен, город или группа"
        aside={
          <ViewSwitch
            label="Вид списка"
            value={layout}
            onChange={(v) => go({ layout: v === 'groups' ? null : v }, true)}
            options={[
              ['groups', 'По группам', <AccountTreeOutlinedIcon key="g" fontSize="small" />],
              ['list', 'Общим списком', <ViewListOutlinedIcon key="l" fontSize="small" />],
            ]}
          />
        }
      />

      {selected.length ? (
        <Box
          data-testid="sandbox-bulkbar"
          sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5, p: 1.25, borderRadius: `${shape.radiusLarge}px`, bgcolor: accent.washSoft, border: `1px solid ${accent.main}` }}
        >
          <Typography sx={{ ...typo.caption, fontWeight: 700, color: accent.soft, mr: 1 }}>
            Выбрано {selected.length} {plural(selected.length, 'отель', 'отеля', 'отелей')}
          </Typography>
          <Button size="small" sx={secondaryButtonSx} onClick={() => setDialog('move')}>В группу…</Button>
          <Button size="small" sx={secondaryButtonSx}>Включить модуль…</Button>
          <Button size="small" sx={secondaryButtonSx}>Выгрузить список</Button>
          <Button size="small" sx={{ ...secondaryButtonSx, color: state.bad }} onClick={() => setDialog('bulk-disable')}>Отключить…</Button>
          <Button size="small" sx={{ ml: 'auto', color: ink.mid }} onClick={() => setSelected([])}>Снять выбор</Button>
        </Box>
      ) : null}

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5, ...typo.caption, color: ink.mid }}>
        <Sample /> групп у платформы пока нет — состав для макета; перетащите отель на группу, чтобы перенести
      </Box>

      {!ready ? <Box sx={{ ...panelSx, ...typo.body, color: ink.mid }}>Загружаем отели…</Box> : null}

      {ready && !shown.length ? (
        <Box sx={panelSx}>
          <Empty
            title="Ничего не нашлось"
            action={<Button sx={secondaryButtonSx} onClick={() => go(Object.fromEntries(['q', ...KEYS].map((k) => [k, null])), true)}>Сбросить поиск и фильтры</Button>}
          >
            Ни один отель и ни одна группа не подходят под поиск и фильтры. Проверьте написание или уберите часть фильтров.
          </Empty>
        </Box>
      ) : null}

      {ready && shown.length && layout === 'list' ? <HotelTable views={shown} showGroup {...tableProps} /> : null}

      {ready && shown.length && layout === 'groups' ? (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          {groups.map((g) => {
            const inGroup = shown.filter((v) => v.group?.id === g.id);
            if (!inGroup.length && searching) return null;
            const all = views.filter((v) => v.group?.id === g.id);
            // Поиск раскрывает группы, в которых что-то нашлось.
            const open = searching ? true : !closed.has(g.id);
            return (
              <GroupBlock
                key={g.id}
                title={<Hl text={g.title} q={q} />}
                all={all}
                open={open}
                onToggle={() => setClosed(g.id)}
                onDrop={(sub) => moveTo([sub], g.id)}
                actions={<Button size="small" sx={{ color: ink.mid }} onClick={() => setRenaming(g)}>Переименовать</Button>}
                emptyHint="В группе пока нет отелей. Выберите отели ниже и нажмите «В группу…» или перетащите их сюда."
              >
                <HotelTable views={inGroup} {...tableProps} />
              </GroupBlock>
            );
          })}
          {shown.some((v) => !v.group) ? (
            <GroupBlock
              title="Отели без группы"
              hint="Отдельные отели. Выберите их и нажмите «В группу…» или перетащите на группу выше."
              all={views.filter((v) => !v.group)}
              open={searching || !closed.has('none')}
              onToggle={() => setClosed('none')}
              onDrop={(sub) => moveTo([sub], null)}
              muted
            >
              <HotelTable views={shown.filter((v) => !v.group)} {...tableProps} />
            </GroupBlock>
          ) : null}
        </Box>
      ) : null}

      {dialog === 'move' ? (
        <MoveDialog
          count={selected.length}
          groups={groups}
          onClose={() => setDialog(null)}
          onMove={(id) => {
            moveTo(selected, id);
            setSelected([]);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === 'new-group' || renaming ? (
        <GroupNameDialog
          initial={renaming?.title ?? ''}
          onClose={() => {
            setDialog(null);
            setRenaming(null);
          }}
          onSave={(title) => {
            if (renaming) setGroups((cur) => cur.map((g) => (g.id === renaming.id ? { ...g, title } : g)));
            else setGroups((cur) => [...cur, { id: `g-${cur.length + 1}`, title, hotels: [] }]);
            setDialog(null);
            setRenaming(null);
          }}
        />
      ) : null}
      {dialog === 'bulk-disable' ? (
        <AdminDialog
          testId="sandbox-bulk-disable"
          title={`Отключить ${selected.length || 2} ${plural(selected.length || 2, 'отель', 'отеля', 'отелей')}?`}
          subtitle="Гости увидят «Отель временно не принимает заказы», сотрудники не смогут войти. Данные и настройки сохранятся."
          onClose={() => setDialog(null)}
          actions={
            <>
              <Button sx={{ color: ink.mid }} onClick={() => setDialog(null)}>Отмена</Button>
              <Button sx={primaryButtonSx} disabled>Отключить</Button>
            </>
          }
        >
          <TextField label="Причина — видна только в Control" required multiline minRows={2} fullWidth sx={fieldSx} />
        </AdminDialog>
      ) : null}
    </Box>
  );
}

/* ── Группа ─────────────────────────────────────────────────────────────── */

function linkSummary(all: View[]): ReactNode {
  const online = all.filter((v) => v.link === 'online').length;
  const silent = all.filter((v) => v.link === 'silent').length;
  const none = all.filter((v) => v.link === 'none' && v.state !== 'disabled').length;
  const part = (tone: Tone, text: string) => (
    <Box component="span" sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center', whiteSpace: 'nowrap' }}>
      <Dot tone={tone} />
      {text}
    </Box>
  );
  return (
    <Box component="span" sx={{ display: 'inline-flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
      {silent ? part('bad', `${silent} не на связи`) : null}
      {online ? part('ok', `${online} на связи`) : null}
      {none ? part('muted', `${none} без коннектора`) : null}
    </Box>
  );
}

function GroupBlock({
  title,
  hint,
  emptyHint,
  all,
  open,
  onToggle,
  onDrop,
  actions,
  muted,
  children,
}: {
  title: ReactNode;
  hint?: string;
  emptyHint?: string;
  all: View[];
  open: boolean;
  onToggle: () => void;
  onDrop: (sub: string) => void;
  actions?: ReactNode;
  muted?: boolean;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const rooms = all.reduce((sum, v) => sum + v.rooms, 0);
  const problems = all.reduce((sum, v) => sum + v.problems.length, 0);
  const bad = all.some((v) => v.problems.some((p) => p.severity === 'bad'));
  return (
    <Box
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        const sub = e.dataTransfer.getData('text/hotel');
        if (sub) onDrop(sub);
      }}
      sx={{ ...panelSx, p: 0, overflow: 'hidden', outline: over ? `2px dashed ${accent.main}` : 'none' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1.25, flexWrap: 'wrap', borderBottom: open ? `1px solid ${surface.line}` : 'none' }}>
        <ButtonBase onClick={onToggle} aria-expanded={open} sx={{ gap: 0.75, borderRadius: `${shape.radius}px`, pr: 1, textAlign: 'left', minWidth: 0 }}>
          {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          <Typography component="h2" sx={{ ...typo.panelTitle, color: muted ? ink.mid : ink.hi }}>{title}</Typography>
        </ButtonBase>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', ...typo.caption, color: ink.mid, flex: '1 1 auto' }}>
          <span>{all.length} {plural(all.length, 'отель', 'отеля', 'отелей')}</span>
          <span>{rooms} {plural(rooms, 'номер', 'номера', 'номеров')}</span>
          {problems ? (
            <Pill tone={bad ? 'bad' : 'warn'}>{problems} {plural(problems, 'проблема', 'проблемы', 'проблем')}</Pill>
          ) : all.length ? (
            <Pill tone="ok">без проблем</Pill>
          ) : null}
          {linkSummary(all)}
        </Box>
        {actions}
      </Box>
      {open ? (
        <Box>
          {hint ? <Typography sx={{ ...typo.caption, color: ink.mid, px: 2, pt: 1 }}>{hint}</Typography> : null}
          {!all.length && emptyHint ? <Typography sx={{ ...typo.body, color: ink.mid, p: 2 }}>{emptyHint}</Typography> : children}
        </Box>
      ) : null}
    </Box>
  );
}

/* ── Таблица и карточки отелей ──────────────────────────────────────────── */

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
  if (v.state === 'disabled') return <Pill tone="muted">отключён</Pill>;
  if (!v.problems.length) return <Pill tone="ok">готов</Pill>;
  const bad = v.problems.some((p) => p.severity === 'bad');
  return <Pill tone={bad ? 'bad' : 'warn'}>{v.problems.length} {plural(v.problems.length, 'проблема', 'проблемы', 'проблем')}</Pill>;
}

function LinkCell({ kind }: { kind: LinkKind }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, whiteSpace: 'nowrap', color: kind === 'none' ? ink.low : ink.hi }}>
      <Dot tone={LINK[kind].tone} />
      {LINK[kind].label}
    </Box>
  );
}

function Th({ children, align }: { children?: ReactNode; align?: 'right' }) {
  return (
    <Box component="th" sx={{ ...typo.label, color: ink.mid, textAlign: align ?? 'left', px: 1.25, py: 1, borderBottom: `1px solid ${surface.line}`, whiteSpace: 'nowrap' }}>
      {children}
    </Box>
  );
}

function HotelTable({
  views,
  selected,
  onToggle,
  onOpen,
  q,
  narrow,
  showGroup = false,
}: {
  views: View[];
  selected: string[];
  onToggle: (sub: string) => void;
  onOpen: (id: string) => void;
  q: string;
  narrow: boolean;
  showGroup?: boolean;
}) {
  const drag = (sub: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => e.dataTransfer.setData('text/hotel', sub),
  });
  if (narrow) {
    return (
      <Box sx={{ display: 'grid', gap: 1, p: showGroup ? 0 : 1 }}>
        {views.map((v) => (
          <Box key={v.sub} {...drag(v.sub)} sx={{ ...panelSx, p: 1.5, display: 'flex', gap: 1, opacity: v.state === 'disabled' ? 0.62 : 1, outline: selected.includes(v.sub) ? `2px solid ${accent.main}` : 'none' }}>
            <Checkbox size="small" checked={selected.includes(v.sub)} onChange={() => onToggle(v.sub)} sx={{ alignSelf: 'flex-start', m: -0.75 }} inputProps={{ 'aria-label': `Выбрать ${v.name}` }} />
            <ButtonBase onClick={() => onOpen(v.line.row.id)} sx={{ flex: 1, minWidth: 0, display: 'block', textAlign: 'left' }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}><Hl text={v.name} q={q} /></Box>
                  <Box sx={{ ...typo.caption, color: ink.mid }}>
                    <Hl text={v.sub} q={q} /> · {v.rooms} {plural(v.rooms, 'номер', 'номера', 'номеров')}
                    {showGroup && v.group ? <> · <Hl text={v.group.title} q={q} /></> : null}
                  </Box>
                </Box>
                <StateCell v={v} />
              </Box>
              <Box sx={{ mt: 1, ...typo.caption }}><LinkCell kind={v.link} /></Box>
              {v.modulesOn.length ? <Box sx={{ mt: 1 }}><ModulesCell codes={v.modulesOn} /></Box> : null}
            </ButtonBase>
          </Box>
        ))}
      </Box>
    );
  }
  return (
    <Box sx={showGroup ? { ...panelSx, p: 0, overflowX: 'auto' } : { overflowX: 'auto' }}>
      {/* Ширины закреплены: таблицы разных групп стоят одна под другой и
          должны идти ровными столбцами. */}
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
            <Box component="th" sx={{ borderBottom: `1px solid ${surface.line}` }} />
            <Th>Отель</Th>
            {showGroup ? <Th>Группа</Th> : null}
            <Th align="right">Номера</Th>
            <Th>Модули</Th>
            <Th>
              Связь
              <Help>Связь коннектора — программы на сервере отеля, через которую гость управляет светом и климатом. «Не на связи» — коннектор молчит дольше 3 минут.</Help>
            </Th>
            <Th>
              Состояние
              <Help>«Готов» — все проверки обзора отеля пройдены. Число проблем — сколько проверок не прошло; красная — мешает гостю уже сейчас.</Help>
            </Th>
          </Box>
        </Box>
        <Box component="tbody">
          {views.map((v) => (
            <Box
              component="tr"
              key={v.sub}
              {...drag(v.sub)}
              onClick={() => onOpen(v.line.row.id)}
              sx={{
                cursor: 'pointer',
                bgcolor: selected.includes(v.sub) ? accent.washSoft : undefined,
                opacity: v.state === 'disabled' ? 0.62 : 1,
                '&:hover': { bgcolor: surface.s2 },
                '& td': { px: 1.25, py: 1.1, borderBottom: `1px solid ${surface.hair}`, verticalAlign: 'middle' },
              }}
            >
              <Box component="td" onClick={(e) => e.stopPropagation()}>
                <Checkbox size="small" checked={selected.includes(v.sub)} onChange={() => onToggle(v.sub)} inputProps={{ 'aria-label': `Выбрать ${v.name}` }} />
              </Box>
              <Box component="td">
                <Box sx={{ fontWeight: 700, color: ink.hi }}><Hl text={v.name} q={q} /></Box>
                <Box sx={{ ...typo.caption, color: ink.mid }}>
                  <Hl text={v.sub} q={q} />
                  {v.city ? <> · <Hl text={v.city} q={q} /></> : null}
                </Box>
              </Box>
              {showGroup ? (
                <Box component="td" sx={{ color: v.group ? ink.hi : ink.low }}>{v.group ? <Hl text={v.group.title} q={q} /> : 'без группы'}</Box>
              ) : null}
              <Box component="td" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.rooms}</Box>
              <Box component="td"><ModulesCell codes={v.modulesOn} /></Box>
              <Box component="td"><LinkCell kind={v.link} /></Box>
              <Box component="td"><StateCell v={v} /></Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

/* ── Окна групп ─────────────────────────────────────────────────────────── */

function MoveDialog({ count, groups, onClose, onMove }: { count: number; groups: Group[]; onClose: () => void; onMove: (id: string | null) => void }) {
  const [target, setTarget] = useState<string>(groups[0]?.id ?? 'none');
  const choices = [
    ...groups.map((g) => ({ id: g.id, title: g.title, note: `${g.hotels.length} ${plural(g.hotels.length, 'отель', 'отеля', 'отелей')}` })),
    { id: 'none', title: 'Без группы', note: 'убрать из группы' },
  ];
  return (
    <AdminDialog
      testId="sandbox-move"
      title={`Перенести ${count} ${plural(count, 'отель', 'отеля', 'отелей')} в группу`}
      subtitle="Отель состоит не больше чем в одной группе: из прежней он уйдёт сам."
      onClose={onClose}
      actions={
        <>
          <Button sx={{ color: ink.mid }} onClick={onClose}>Отмена</Button>
          <Button sx={primaryButtonSx} onClick={() => onMove(target === 'none' ? null : target)}>Перенести</Button>
        </>
      }
    >
      {choices.map((g) => (
        <ButtonBase key={g.id} onClick={() => setTarget(g.id)} sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', gap: 1, py: 0.5, borderRadius: `${shape.radius}px`, textAlign: 'left' }}>
          <Radio size="small" checked={target === g.id} />
          <Box>
            <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{g.title}</Box>
            <Box sx={{ ...typo.caption, color: ink.mid }}>{g.note}</Box>
          </Box>
        </ButtonBase>
      ))}
    </AdminDialog>
  );
}

function GroupNameDialog({ initial, onClose, onSave }: { initial: string; onClose: () => void; onSave: (title: string) => void }) {
  const [title, setTitle] = useState(initial);
  return (
    <AdminDialog
      testId="sandbox-group-name"
      title={initial ? 'Переименовать группу' : 'Новая группа'}
      subtitle="Группа объединяет отели одного владельца. Название видно только в Control: гостям и сотрудникам отелей его не показываем."
      onClose={onClose}
      actions={
        <>
          <Button sx={{ color: ink.mid }} onClick={onClose}>Отмена</Button>
          <Button sx={primaryButtonSx} disabled={!title.trim()} onClick={() => onSave(title.trim())}>{initial ? 'Сохранить' : 'Создать'}</Button>
        </>
      }
    >
      <TextField autoFocus label="Название группы" placeholder="Например, «Отели Метрополь»" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth sx={fieldSx} />
    </AdminDialog>
  );
}
