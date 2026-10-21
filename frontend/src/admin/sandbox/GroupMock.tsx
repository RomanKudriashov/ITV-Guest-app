import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { accent, fieldSx, ink, panelSx, primaryButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../adminTokens';
import type { Go } from './SandboxApp';
import { useFleetLines, type HotelLine } from './sandboxData';
import { MODULES } from './moduleCatalog';
import { SILENT_AFTER_S, plural, quickProblems } from './readiness';
import { FilterBar, passes, useFilters } from './FilterBar';
import { dateTime } from './words';
import { byOrder, groupsStore, useGroups, type Group } from './groupsStore';
import { AddHotelsDialog, ColorPicker, DeleteGroupDialog, GroupActionDialog, GroupMark } from './groupDialogs';
import { AddressTabs, Dot, Empty, Help, Hl, KV, Metric, PageHead, Panel, Pill, Sample, type Tone } from './ui';

/**
 * СТРАНИЦА ГРУППЫ (партия 62, третий заход) — `?s=hotels&group=<id>&gtab=`.
 * Профиль, отели, сводка, действия по всей группе, умолчания для новых
 * отелей, история. Всё, что меняется, меняется в памяти песочницы.
 */

type GTab = 'profile' | 'hotels' | 'summary' | 'actions' | 'defaults' | 'history';

const TABS: Array<{ key: GTab; label: string; about: string }> = [
  { key: 'summary', label: 'Сводка', about: 'Как дела у отелей группы целиком: проблемы, связь, какие модули включены.' },
  { key: 'hotels', label: 'Отели', about: 'Состав группы. Добавить отель — перенести его сюда из другой группы или из «без группы».' },
  { key: 'profile', label: 'Профиль', about: 'Как группа называется и выглядит в списке отелей. Видно только нашей команде.' },
  { key: 'actions', label: 'Действия', about: 'Одно действие сразу во всех отелях группы. Перед выполнением окно покажет, что изменится и у кого.' },
  { key: 'defaults', label: 'Умолчания', about: 'Что включается у отеля автоматически, когда его добавляют в группу.' },
  { key: 'history', label: 'История', about: 'Кто, когда и что поменял в группе — с тем, что было и что стало.' },
];

type LinkKind = 'online' | 'silent' | 'none';
const linkOf = (l: HotelLine): LinkKind => {
  const live = l.nodes.filter((n) => !n.is_revoked);
  if (!live.length) return 'none';
  return live.some((n) => n.seconds_since_seen == null || n.seconds_since_seen > SILENT_AFTER_S) ? 'silent' : 'online';
};
const LINK: Record<LinkKind, [string, Tone]> = { online: ['на связи', 'ok'], silent: ['не на связи', 'bad'], none: ['нет коннектора', 'muted'] };

export function GroupMock({ id, go }: { id: string; go: Go }) {
  const [params] = useSearchParams();
  const tab = (params.get('gtab') as GTab) || 'summary';
  const groups = useGroups();
  const group = groups.find((g) => g.id === id);
  const { lines } = useFleetLines();
  const [dialog, setDialog] = useState<string | null>(params.get('dialog'));

  if (!group) {
    return (
      <Box sx={panelSx}>
        <Empty title="Группы нет" action={<Button sx={secondaryButtonSx} onClick={() => go({ group: null, gtab: null })}>К отелям</Button>}>
          Её удалили или ссылка устарела. Отели группы остались — они в «Отелях без группы».
        </Empty>
      </Box>
    );
  }
  const inGroup = lines.filter((l) => group.hotels.includes(l.row.subdomain));
  const problems = inGroup.reduce((n, l) => n + (l.row.is_active ? quickProblems(l.modules, l.nodes, l.admins).length : 0), 0);
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <Box>
      <Button size="small" sx={{ color: accent.soft, mb: 1, px: 0.5 }} onClick={() => go({ group: null, gtab: null, dialog: null })}>← Все отели</Button>
      <PageHead
        title={group.title}
        subtitle={
          <Box component="span" sx={{ display: 'inline-flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <GroupMark color={group.color} />
            {group.description || 'Описания нет'}
            <Sample />
          </Box>
        }
        actions={<Button sx={secondaryButtonSx} onClick={() => setDialog('add')}>+ Добавить отели</Button>}
      />
      <AddressTabs
        tabs={TABS.map((t) => (t.key === 'summary' && problems ? { ...t, badge: problems, tone: 'warn' } : t.key === 'hotels' ? { ...t, badge: inGroup.length } : t))}
        active={tab}
        onChange={(key) => go({ gtab: key, dialog: null, q: null, state: null, link: null, who: null, what: null })}
      />
      <Typography sx={{ ...typo.body, color: ink.mid, mt: -0.5, mb: 2 }}>{current.about}</Typography>

      {tab === 'summary' ? <Summary group={group} lines={inGroup} go={go} /> : null}
      {tab === 'hotels' ? <Hotels lines={inGroup} go={go} onAdd={() => setDialog('add')} /> : null}
      {tab === 'profile' ? <Profile group={group} groups={groups} onDelete={() => setDialog('delete')} /> : null}
      {tab === 'actions' ? <Actions lines={inGroup} onOpen={setDialog} /> : null}
      {tab === 'defaults' ? <Defaults group={group} /> : null}
      {tab === 'history' ? <History group={group} go={go} /> : null}

      {dialog === 'add' ? <AddHotelsDialog group={group} lines={lines} groups={groups} initial={(params.get('pick') ?? '').split(',').filter(Boolean)} onClose={() => setDialog(null)} /> : null}
      {dialog === 'delete' ? <DeleteGroupDialog group={group} lines={lines} onClose={() => setDialog(null)} onDeleted={() => go({ group: null, gtab: null, dialog: null })} /> : null}
      {dialog === 'module' || dialog === 'disable' || dialog === 'enable' ? (
        <GroupActionDialog kind={dialog} group={group} lines={lines} onClose={() => setDialog(null)} />
      ) : null}
    </Box>
  );
}

/* ── Сводка ─────────────────────────────────────────────────────────────── */

function Summary({ group, lines, go }: { group: Group; lines: HotelLine[]; go: Go }) {
  const rooms = lines.reduce((n, l) => n + (l.profile?.counts.rooms ?? 0), 0);
  const withProblems = lines.filter((l) => l.row.is_active && quickProblems(l.modules, l.nodes, l.admins).length);
  const links = (['online', 'silent', 'none'] as LinkKind[]).map((k) => [k, lines.filter((l) => linkOf(l) === k).length] as const);
  if (!lines.length) {
    return (
      <Box sx={panelSx}>
        <Empty title="В группе пока нет отелей" action={<Button sx={primaryButtonSx} onClick={() => go({ gtab: 'hotels' })}>Добавить отели</Button>}>
          Сводка появится, когда в группе будет хотя бы один отель.
        </Empty>
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
        <Metric label="Отели" value={lines.length} hint={`работают — ${lines.filter((l) => l.row.is_active).length}`} />
        <Metric label="Номера" value={rooms} hint="во всех отелях группы" />
        <Metric label="С проблемами" value={withProblems.length} tone={withProblems.length ? 'warn' : 'ok'} hint={withProblems.length ? withProblems.map((l) => l.profile?.name ?? l.row.name).join(', ') : 'всё готово'} />
        <Metric
          label="Связь"
          value={`${links[0][1]} из ${lines.length}`}
          tone={links[1][1] ? 'bad' : undefined}
          hint={`не на связи — ${links[1][1]}, без коннектора — ${links[2][1]}`}
        />
      </Box>
      <Panel title="Модули по группе" aside={<Help>Сколько отелей группы используют каждый модуль. Включить или выключить сразу у всех — во вкладке «Действия».</Help>}>
        {MODULES.filter((m) => m.status === 'ready').map((m) => {
          const on = lines.filter((l) => l.modules.some((x) => x.code === m.code && x.is_enabled)).length;
          return (
            <Box key={m.code} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 70px', sm: '220px 1fr 70px' }, gap: 1.5, alignItems: 'center', py: 0.75, borderBottom: `1px solid ${surface.hair}` }}>
              <Box sx={{ ...typo.body, color: m.status === 'ready' ? ink.hi : ink.mid, fontWeight: 600 }}>
                {m.title}
                {m.status === 'dev' ? <Box component="span" sx={{ ...typo.caption, color: ink.low }}> · в разработке</Box> : null}
              </Box>
              <Box sx={{ display: { xs: 'none', sm: 'block' }, height: 8, borderRadius: 4, bgcolor: surface.s2, overflow: 'hidden' }}>
                <Box sx={{ width: `${(on / lines.length) * 100}%`, height: '100%', bgcolor: m.status === 'ready' ? accent.main : 'var(--adm-state-muted-wash)' }} />
              </Box>
              <Box sx={{ ...typo.caption, color: ink.mid, textAlign: 'right' }}>{on} из {lines.length}</Box>
            </Box>
          );
        })}
        {(() => {
          const dev = MODULES.filter((m) => m.status === 'dev' && lines.some((l) => l.modules.some((x) => x.code === m.code && x.is_enabled)));
          return dev.length ? (
            <Typography sx={{ ...typo.caption, color: ink.mid, mt: 1.25 }}>
              Включены, но ещё в разработке и ничего не делают (выключатся при переходе): {dev.map((m) => m.title).join(', ')}.
            </Typography>
          ) : null;
        })()}
      </Panel>
      {group.note ? (
        <Panel title="Заметка для команды">
          <Box sx={{ ...typo.body, color: ink.hi }}>{group.note}</Box>
        </Panel>
      ) : null}
    </Box>
  );
}

/* ── Отели ──────────────────────────────────────────────────────────────── */

function Hotels({ lines, go, onAdd }: { lines: HotelLine[]; go: Go; onAdd: () => void }) {
  const { q, values } = useFilters(['state', 'link']);
  const ql = q.toLowerCase();
  const stateOf = (l: HotelLine) => (!l.row.is_active ? 'disabled' : quickProblems(l.modules, l.nodes, l.admins).length ? 'problems' : 'ready');
  const shown = lines.filter(
    (l) => passes(values.state, stateOf(l)) && passes(values.link, linkOf(l)) && (!ql || `${l.profile?.name ?? l.row.name} ${l.row.subdomain} ${l.profile?.city ?? ''}`.toLowerCase().includes(ql)),
  );
  return (
    <Box>
      <FilterBar
        go={go}
        placeholder="Найти отель в группе"
        facets={[
          { key: 'state', label: 'Состояние', options: [{ value: 'problems', label: 'Есть проблемы', tone: 'warn' }, { value: 'ready', label: 'Готов', tone: 'ok' }, { value: 'disabled', label: 'Отключён', tone: 'muted' }] },
          { key: 'link', label: 'Связь', options: (Object.keys(LINK) as LinkKind[]).map((k) => ({ value: k, label: LINK[k][0], tone: LINK[k][1] })) },
        ]}
        aside={<Button sx={primaryButtonSx} onClick={onAdd}>+ Добавить отели</Button>}
      />
      <Box sx={{ ...panelSx, p: 0 }}>
        {!lines.length ? <Empty title="В группе пока нет отелей">Нажмите «Добавить отели» — можно взять отели без группы или перенести из другой группы.</Empty> : null}
        {lines.length && !shown.length ? <Empty title="Под фильтры ничего не попало">Уберите часть фильтров или измените поиск.</Empty> : null}
        {shown.map((l) => {
          const st = stateOf(l);
          const lk = linkOf(l);
          return (
            <Box key={l.row.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', px: 2, py: 1.25, borderBottom: `1px solid ${surface.hair}`, opacity: l.row.is_active ? 1 : 0.62 }}>
              <ButtonBase onClick={() => go({ group: null, gtab: null, hotel: l.row.id, tab: 'overview' })} sx={{ flex: '1 1 220px', minWidth: 0, justifyContent: 'flex-start', textAlign: 'left' }}>
                <Box>
                  <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}><Hl text={l.profile?.name ?? l.row.name} q={q} /></Box>
                  <Box sx={{ ...typo.caption, color: ink.mid }}><Hl text={l.row.subdomain} q={q} /> · {l.profile?.counts.rooms ?? 0} {plural(l.profile?.counts.rooms ?? 0, 'номер', 'номера', 'номеров')}</Box>
                </Box>
              </ButtonBase>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, ...typo.caption, color: ink.mid, whiteSpace: 'nowrap' }}><Dot tone={LINK[lk][1]} />{LINK[lk][0]}</Box>
              <Pill tone={st === 'disabled' ? 'muted' : st === 'problems' ? 'warn' : 'ok'}>{st === 'disabled' ? 'отключён' : st === 'problems' ? 'есть проблемы' : 'готов'}</Pill>
              <Button size="small" sx={{ color: ink.mid }} onClick={() => groupsStore.move([l.row.subdomain], null)}>Убрать из группы</Button>
            </Box>
          );
        })}
      </Box>
      <Typography sx={{ ...typo.caption, color: ink.mid, mt: 1 }}>
        «Убрать из группы» не трогает отель: он переходит в «Отели без группы» со всеми модулями и данными.
      </Typography>
    </Box>
  );
}

/* ── Профиль ────────────────────────────────────────────────────────────── */

function Profile({ group, groups, onDelete }: { group: Group; groups: Group[]; onDelete: () => void }) {
  const ordered = [...groups].sort(byOrder);
  const index = ordered.findIndex((g) => g.id === group.id);
  const swap = (dir: -1 | 1) => {
    const other = ordered[index + dir];
    if (!other) return;
    groupsStore.patch(group.id, { order: other.order });
    groupsStore.patch(other.id, { order: group.order });
  };
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, alignItems: 'start' }}>
      <Panel title="Группа">
        <KV label="Название" help="Как группа называется в списке отелей и в фильтре «Группа».">
          <TextField size="small" fullWidth defaultValue={group.title} onBlur={(e) => e.target.value.trim() && groupsStore.patch(group.id, { title: e.target.value.trim() })} sx={fieldSx} />
        </KV>
        <KV label="Описание" help="Чьи это отели и зачем они вместе. Видно в шапке группы.">
          <TextField size="small" fullWidth multiline minRows={2} defaultValue={group.description} onBlur={(e) => groupsStore.patch(group.id, { description: e.target.value })} sx={fieldSx} />
        </KV>
        <KV label="Заметка для команды" help="Что важно помнить про эти отели: договорённости, контакты, особенности. Видна только нам — в сводке группы.">
          <TextField size="small" fullWidth multiline minRows={2} placeholder="Например: перед показом проверить коннектор" defaultValue={group.note} onBlur={(e) => groupsStore.patch(group.id, { note: e.target.value })} sx={fieldSx} />
        </KV>
        <KV label="Цвет-метка" help="Цветной значок у названия группы — чтобы находить её в списке отелей глазами.">
          <ColorPicker value={group.color} onChange={(color) => groupsStore.patch(group.id, { color })} />
        </KV>
        <KV label="Порядок в списке" note={`${index + 1}-я из ${ordered.length}`} help="В каком порядке группы стоят на экране «Отели». «Отели без группы» всегда внизу.">
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" sx={secondaryButtonSx} disabled={index === 0} onClick={() => swap(-1)}>↑ Выше</Button>
            <Button size="small" sx={secondaryButtonSx} disabled={index === ordered.length - 1} onClick={() => swap(1)}>↓ Ниже</Button>
          </Box>
        </KV>
        <KV label="Входит в группу" note="Вложенные группы заложены в устройство данных; выбор появится, когда понадобится" help="Например, «Москва» внутри «Отели Метрополь». Сейчас группы стоят в один уровень.">
          <Box component="span" sx={{ color: ink.low }}>нет — верхний уровень</Box>
        </KV>
        <Typography sx={{ ...typo.caption, color: ink.low, mt: 1 }}>Правки сохраняются сразу, как только вы уходите из поля.</Typography>
      </Panel>
      <Panel title="Удаление группы">
        <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1.5 }}>
          Удаляется только группа. Отели остаются как есть и переходят в «Отели без группы».
        </Typography>
        <Button sx={{ ...secondaryButtonSx, color: state.bad, borderColor: state.bad }} onClick={onDelete}>Удалить группу…</Button>
      </Panel>
    </Box>
  );
}

/* ── Действия ───────────────────────────────────────────────────────────── */

function Actions({ lines, onOpen }: { lines: HotelLine[]; onOpen: (d: string) => void }) {
  const active = lines.filter((l) => l.row.is_active).length;
  const items: Array<{ key: string; title: string; text: string; button: string; danger?: boolean }> = [
    { key: 'module', title: 'Модуль во всех отелях', text: `Включить или выключить модуль сразу у ${lines.length} ${plural(lines.length, 'отеля', 'отелей', 'отелей')}. Окно покажет, у кого что изменится.`, button: 'Выбрать модуль…' },
    { key: 'disable', title: 'Отключить все отели', text: `Закрыть ${active} ${plural(active, 'работающий отель', 'работающих отеля', 'работающих отелей')} для гостей и сотрудников. Причина обязательна; данные сохранятся.`, button: 'Отключить все…', danger: true },
    { key: 'enable', title: 'Включить все отели', text: `Открыть отключённые отели группы (${lines.length - active}) гостям и сотрудникам.`, button: 'Включить все…' },
  ];
  return (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
      {items.map((it) => (
        <Box key={it.key} sx={{ ...panelSx, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography sx={{ ...typo.panelTitle, color: it.danger ? state.bad : ink.hi }}>{it.title}</Typography>
          <Typography sx={{ ...typo.body, color: ink.mid, flex: 1 }}>{it.text}</Typography>
          <Button sx={it.danger ? { ...secondaryButtonSx, color: state.bad, borderColor: state.bad } : secondaryButtonSx} disabled={!lines.length} onClick={() => onOpen(it.key)}>
            {it.button}
          </Button>
        </Box>
      ))}
      <Typography sx={{ ...typo.caption, color: ink.mid, gridColumn: '1 / -1' }}>
        Каждое действие попадает в историю группы и в историю каждого затронутого отеля.
      </Typography>
    </Box>
  );
}

/* ── Умолчания ──────────────────────────────────────────────────────────── */

function Defaults({ group }: { group: Group }) {
  const ready = MODULES.filter((m) => m.status === 'ready');
  const toggle = (code: string) =>
    groupsStore.patch(group.id, { autoModules: group.autoModules.includes(code) ? group.autoModules.filter((c) => c !== code) : [...group.autoModules, code] });
  const names = group.autoModules.map((c) => `«${MODULES.find((m) => m.code === c)?.title}»`).join(', ');
  return (
    <Panel title="Модули для новых отелей группы">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.25, mb: 1.5, borderRadius: `${shape.radius}px`, bgcolor: group.autoEnabled ? accent.washSoft : surface.s2, border: `1px solid ${group.autoEnabled ? accent.main : surface.line}` }}>
        <Switch checked={group.autoEnabled} onChange={() => groupsStore.patch(group.id, { autoEnabled: !group.autoEnabled })} inputProps={{ 'aria-label': 'Правило включено' }} />
        <Box sx={{ ...typo.body, color: ink.hi, fontWeight: 600 }}>
          {group.autoEnabled
            ? group.autoModules.length
              ? `Правило включено: отелю, добавленному в группу, включится ${names}.`
              : 'Правило включено, но модули не выбраны — ничего не включится.'
            : 'Правило выключено: добавленный отель остаётся с теми модулями, что у него были.'}
        </Box>
      </Box>
      {ready.map((m) => (
        <ButtonBase key={m.code} onClick={() => toggle(m.code)} disabled={!group.autoEnabled} sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', gap: 1, py: 0.5, textAlign: 'left', opacity: group.autoEnabled ? 1 : 0.5 }}>
          <Checkbox size="small" checked={group.autoModules.includes(m.code)} tabIndex={-1} />
          <Box>
            <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{m.title}</Box>
            <Box sx={{ ...typo.caption, color: ink.mid }}>{m.gives}</Box>
          </Box>
        </ButtonBase>
      ))}
      <Box sx={{ mt: 1.5, display: 'grid', gap: 0.5, ...typo.caption, color: ink.mid }}>
        <span>• Правило срабатывает только при добавлении отеля. Отели, которые уже в группе, не меняются — для них есть «Действия».</span>
        <span>• Модули, которым нужно подключение, включатся, но заработают, когда подключение появится; обзор отеля это покажет.</span>
        <span>• Модули в разработке выбрать нельзя.</span>
      </Box>
    </Panel>
  );
}

/* ── История ────────────────────────────────────────────────────────────── */

function History({ group, go }: { group: Group; go: Go }) {
  const { q, values } = useFilters(['who', 'what']);
  const ql = q.toLowerCase();
  const actors = [...new Set(group.history.map((h) => h.actor))];
  const whats = [...new Set(group.history.map((h) => h.what))];
  const shown = group.history.filter(
    (h) => passes(values.who, h.actor) && passes(values.what, h.what) && (!ql || [h.what, h.from, h.to, h.text, h.actor].some((s) => s?.toLowerCase().includes(ql))),
  );
  return (
    <Box>
      <FilterBar
        go={go}
        placeholder="Что искать: отель, поле, сотрудник"
        facets={[
          { key: 'who', label: 'Кто', options: actors.map((a) => ({ value: a, label: a })) },
          { key: 'what', label: 'Что', options: whats.map((w) => ({ value: w, label: w })) },
        ]}
      />
      <Box sx={{ ...panelSx, p: 0 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', px: 2, pt: 1.25, ...typo.caption, color: ink.mid }}>
          <Sample /> групп у платформы пока нет — история для макета
        </Box>
        {!shown.length ? <Empty title="Ничего не нашлось">Уберите часть фильтров или измените поиск.</Empty> : null}
        {shown.map((h, i) => (
          <Box key={i} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '200px 1fr' }, gap: { xs: 0.25, md: 2 }, px: 2, py: 1.25, borderBottom: `1px solid ${surface.hair}` }}>
            <Box sx={{ ...typo.caption, color: ink.mid }}>
              {dateTime(h.at)}
              <Box sx={{ color: ink.low }}><Hl text={h.actor} q={q} /></Box>
            </Box>
            <Box sx={{ ...typo.body, color: ink.hi }}>
              <Box component="span" sx={{ fontWeight: 700 }}><Hl text={h.what} q={q} />: </Box>
              {h.from != null ? (
                <>
                  <Box component="span" sx={{ color: ink.mid, textDecoration: 'line-through' }}><Hl text={h.from} q={q} /></Box>
                  {' → '}
                  <Hl text={h.to ?? '—'} q={q} />
                </>
              ) : (
                <Box component="span" sx={{ color: ink.mid }}><Hl text={h.text ?? ''} q={q} /></Box>
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
