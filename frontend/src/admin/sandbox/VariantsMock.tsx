import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined';

import { accent, fieldSx, ink, panelSx, primaryButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../adminTokens';
import { getHotelsView } from '../adminClient';
import { GrmsScopeProvider, useGrms } from '@/cms/roomControl/scope';
import { contentLanguagesFrom } from '@/hooks/useBootstrap';
import { Help, Panel, Pill } from '../pages/hotels/hotelsUi';
import { STAND_HOTELS, layout, naturalCompare, type MockRoom } from './roomsData';
import { MockAction, PageHead, RoomTip, Sample, VariantBar, paint, useGo, type VariantInfo } from './ui';

/**
 * МАКЕТ 3 — ВАРИАНТЫ НОМЕРОВ (партия 63-М), вместо нынешних вкладок
 * «Импорт · Конструктор · План · Версии». Три варианта:
 *   А «Карточки и шаги»   — список вариантов, внутри — шаги по порядку;
 *   Б «Матрица»           — все варианты × все шаги одной таблицей;
 *   В «От номеров»        — схема отеля цветом варианта, выбрали номера — назначили.
 *
 * Вариант номера — заранее настроенная схема управления (план, кнопки гостя,
 * каналы оборудования), которую получают одинаковые номера: у отеля их 5–10.
 */

const VARIANTS: VariantInfo[] = [
  { key: 'a', title: 'Вариант А · Карточки и шаги', idea: 'варианты — карточками с планом-миниатюрой; внутри шесть шагов по порядку, от основы до публикации, у каждого видно, готов ли он.' },
  { key: 'b', title: 'Вариант Б · Матрица', idea: 'все варианты и все шаги в одной таблице: сразу видно, у кого что не доделано; щелчок по клетке открывает шаг.' },
  { key: 'c', title: 'Вариант В · От номеров', idea: 'начинаем со схемы отеля: номера покрашены вариантом, выделяем этаж или стояк — назначаем; вариант правится сбоку.' },
];

type StepKey = 'base' | 'plan' | 'buttons' | 'rooms' | 'check' | 'publish';
const STEPS: Array<{ key: StepKey; title: string; help: string }> = [
  { key: 'base', title: 'Основа', help: 'Название варианта и, по желанию, файл пусконаладки — из него подтянутся каналы оборудования.' },
  { key: 'plan', title: 'План', help: 'Картинка номера и зоны на ней: спальня, гостиная, ванная. Гость нажимает прямо на план.' },
  { key: 'buttons', title: 'Кнопки для гостя', help: 'Что гость видит словами: «Свет в спальне», «Шторы», «Климат». Каналы оборудования — в свёрнутом инженерном блоке.' },
  { key: 'rooms', title: 'Номера', help: 'Каким номерам достаётся этот вариант: по маске «…05», этажам, стояку, корпусу или прямо на схеме.' },
  { key: 'check', title: 'Проверка', help: 'Выберите номер и нажмите кнопку — свет в номере мигнёт. Перед проверкой — подтверждение: в номере может быть гость.' },
  { key: 'publish', title: 'Публикация', help: 'Черновик становится текущей версией у всех номеров варианта. Видно, что изменится и у скольких.' },
];

type Done = 'done' | 'draft' | 'none';

interface MockVariant {
  code: string;
  title: string;
  rooms: number;
  state: 'published' | 'draft' | 'empty';
  steps: Record<StepKey, Done>;
  zones: number;
  sample: boolean;
  variables: Array<{ key: string; command: string }>;
}

/** Живые варианты «Кристалла» (локально) + образцы, чтобы их было 5–10. */
function useVariants(): { list: MockVariant[]; crystalId: string | null } {
  const fleet = useQuery({ queryKey: ['sandbox63', 'crystal'], queryFn: () => getHotelsView({ layout: 'list', origin: 'all', search: 'crystal' }) });
  const crystalId = fleet.data?.items.find((r) => r.subdomain === 'crystal')?.id ?? null;
  const samples: MockVariant[] = [
    { code: 'deluxe', title: 'Делюкс', rooms: 64, state: 'published', steps: { base: 'done', plan: 'done', buttons: 'done', rooms: 'done', check: 'done', publish: 'done' }, zones: 3, sample: true, variables: [] },
    { code: 'junior', title: 'Полулюкс', rooms: 38, state: 'draft', steps: { base: 'done', plan: 'done', buttons: 'draft', rooms: 'done', check: 'none', publish: 'none' }, zones: 3, sample: true, variables: [] },
    { code: 'suite', title: 'Люкс', rooms: 22, state: 'draft', steps: { base: 'done', plan: 'draft', buttons: 'none', rooms: 'done', check: 'none', publish: 'none' }, zones: 4, sample: true, variables: [] },
    { code: 'villa', title: 'Вилла', rooms: 12, state: 'empty', steps: { base: 'done', plan: 'none', buttons: 'none', rooms: 'none', check: 'none', publish: 'none' }, zones: 0, sample: true, variables: [] },
    { code: 'residence', title: 'Резиденция', rooms: 0, state: 'empty', steps: { base: 'draft', plan: 'none', buttons: 'none', rooms: 'none', check: 'none', publish: 'none' }, zones: 0, sample: true, variables: [] },
  ];
  return { list: samples, crystalId };
}

function LiveVariants({ onReady }: { onReady: (v: MockVariant[]) => ReactNode }) {
  const grms = useGrms();
  const types = useQuery({ queryKey: ['sandbox63', 'grms-types', grms.base], queryFn: grms.types, retry: false });
  const live: MockVariant[] = (types.data?.types ?? []).map((t) => ({
    code: t.code,
    title: t.title.ru ?? Object.values(t.title)[0] ?? 'Без названия',
    rooms: t.rooms.length,
    state: 'published',
    steps: { base: 'done', plan: t.plan_level === 'tiles' ? 'none' : 'done', buttons: 'done', rooms: t.rooms.length ? 'done' : 'none', check: 'done', publish: 'done' },
    zones: 2,
    sample: false,
    variables: t.variables.slice(0, 12).map((x) => ({ key: x.key, command: x.command })),
  }));
  return <>{onReady(live)}</>;
}

export function VariantsMock() {
  const [params, go] = useGo();
  const v = params.get('v') || 'a';
  const { list: samples, crystalId } = useVariants();
  const body = (live: MockVariant[]) => {
    const all = [...live, ...samples];
    return (
      <>
        <Overview variants={all} />
        {v === 'a' ? <CardsAndSteps variants={all} /> : null}
        {v === 'b' ? <Matrix variants={all} /> : null}
        {v === 'c' ? <FromRooms variants={all} /> : null}
      </>
    );
  };
  return (
    <Box data-testid="sandbox-variants-screen">
      <PageHead
        title="Управление номером"
        subtitle="Вариант номера — заранее настроенная схема: план, кнопки для гостя и каналы оборудования. Одинаковые номера (обычно друг под другом по этажам) получают один вариант. Варианты «Кристалла» — настоящие (локально), остальные — образец."
      />
      <VariantBar variants={VARIANTS} value={v} onChange={(key) => go({ v: key, variant: null, step: null })} />
      {crystalId ? (
        <GrmsScopeProvider hotelId={crystalId} languages={contentLanguagesFrom([{ code: 'ru', title: 'Русский', is_default: true }], 'ru', 'ru')}>
          <LiveVariants onReady={body} />
        </GrmsScopeProvider>
      ) : (
        body([])
      )}
    </Box>
  );
}

/* ── Общий обзор: подключение → варианты → номера → опубликовано ─────────── */

function Overview({ variants }: { variants: MockVariant[] }) {
  const totalRooms = 272;
  const bound = variants.reduce((n, v) => n + v.rooms, 0);
  const published = variants.filter((v) => v.state === 'published').reduce((n, v) => n + v.rooms, 0);
  const stages: Array<{ title: string; value: string; tone: 'ok' | 'warn' | 'bad'; note: string }> = [
    { title: 'Подключение', value: 'на связи', tone: 'ok', note: 'коннектор и сервер управления' },
    { title: 'Варианты', value: `${variants.filter((v) => v.state !== 'empty').length} из ${variants.length} настроены`, tone: variants.some((v) => v.state === 'empty') ? 'warn' : 'ok', note: 'план, кнопки, проверка' },
    { title: 'Номера', value: `${bound} из ${totalRooms} привязаны`, tone: bound < totalRooms ? 'warn' : 'ok', note: 'остальные без управления' },
    { title: 'Опубликовано', value: `у ${published} номеров`, tone: published < bound ? 'warn' : 'ok', note: 'гость видит текущую версию' },
  ];
  return (
    <Panel title="Обзор" aside={<Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}><Sample>часть цифр — образец</Sample><Help>Путь от подключения до того, как гость управляет номером: на каком шаге отель и что мешает.</Help></Box>}>
      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }} data-testid="sandbox-overview">
        {stages.map((s, i) => (
          <Box key={s.title} sx={{ p: 1.25, borderRadius: `${shape.radius}px`, border: `1px solid ${surface.line}`, position: 'relative' }}>
            <Box sx={{ ...typo.label, color: ink.mid }}>{i + 1}. {s.title}</Box>
            <Box sx={{ ...typo.body, fontWeight: 800, color: state[s.tone], mt: 0.5 }}>{s.value}</Box>
            <Box sx={{ ...typo.caption, color: ink.low }}>{s.note}</Box>
          </Box>
        ))}
      </Box>
    </Panel>
  );
}

function StatePill({ v }: { v: MockVariant }) {
  return v.state === 'published' ? <Pill tone="ok">опубликован</Pill> : v.state === 'draft' ? <Pill tone="warn">есть черновик</Pill> : <Pill tone="muted">не настроен</Pill>;
}

/** План-миниатюра: прямоугольник номера и зоны — из словаря цветов. */
function PlanThumb({ zones, size = 120 }: { zones: number; size?: number }) {
  const h = size * 0.62;
  const parts = Math.max(zones, 1);
  return (
    <Box component="svg" viewBox={`0 0 ${size} ${h}`} sx={{ width: size, height: h, display: 'block' }} aria-hidden>
      <rect x="2" y="2" width={size - 4} height={h - 4} rx="6" fill="var(--adm-surface-s2)" stroke="var(--adm-surface-line)" strokeWidth="2" />
      {zones
        ? Array.from({ length: parts }).map((_, i) => (
            <rect
              key={i}
              x={4 + ((size - 8) / parts) * i}
              y="4"
              width={(size - 8) / parts - 3}
              height={h - 8}
              rx="4"
              fill={i % 2 ? 'var(--adm-accent-wash)' : 'var(--adm-state-info-wash)'}
              stroke="var(--adm-surface-hair)"
            />
          ))
        : <text x={size / 2} y={h / 2 + 4} textAnchor="middle" fontSize="10" fill="var(--adm-ink-low)">плана нет</text>}
    </Box>
  );
}

function StepIcon({ done }: { done: Done }) {
  return done === 'done' ? <CheckCircleOutlineIcon sx={{ fontSize: 18, color: state.ok }} /> : done === 'draft' ? <EditNoteOutlinedIcon sx={{ fontSize: 18, color: state.warn }} /> : <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: ink.low }} />;
}

/* ── А: карточки и шаги ──────────────────────────────────────────────────── */

function CardsAndSteps({ variants }: { variants: MockVariant[] }) {
  const [params, go] = useGo();
  const open = variants.find((v) => v.code === params.get('variant'));
  const [copy, setCopy] = useState(false);
  if (open) return <VariantEditor v={open} onBack={() => go({ variant: null, step: null })} />;
  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Button sx={primaryButtonSx}>+ Новый вариант</Button>
        <Button sx={secondaryButtonSx} onClick={() => setCopy(true)} data-testid="sandbox-copy-variant">Скопировать вариант…</Button>
      </Box>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)' } }}>
        {variants.map((v) => (
          <ButtonBase key={v.code} onClick={() => go({ variant: v.code, step: 'base' })} data-testid={`sandbox-variant-card-${v.code}`} sx={{ ...panelSx, display: 'grid', gap: 1, textAlign: 'start', justifyItems: 'start' }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', width: '100%' }}>
              <Box sx={{ ...typo.panelTitle, color: ink.hi, flex: 1 }}>{v.title}</Box>
              {v.sample ? <Sample /> : null}
            </Box>
            <PlanThumb zones={v.zones} />
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <StatePill v={v} />
              <Box sx={{ ...typo.caption, color: ink.mid }}>{v.rooms ? `${v.rooms} номеров` : 'номеров нет'}</Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5 }}>{STEPS.map((s) => <StepIcon key={s.key} done={v.steps[s.key]} />)}</Box>
          </ButtonBase>
        ))}
      </Box>
      {copy ? <CopyDialog onClose={() => setCopy(false)} /> : null}
    </Box>
  );
}

function CopyDialog({ onClose }: { onClose: () => void }) {
  const [from, setFrom] = useState<'here' | 'hotel' | 'template'>('here');
  return (
    <MockAction title="Скопировать вариант" onClose={onClose} confirm="Скопировать">
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {([['here', 'в этом отеле'], ['hotel', 'из другого отеля'], ['template', 'из шаблона']] as const).map(([k, label]) => (
          <ButtonBase key={k} onClick={() => setFrom(k)} sx={{ px: 1.25, py: 0.5, borderRadius: `${shape.pill}px`, ...typo.caption, fontWeight: 700, border: `1px solid ${from === k ? accent.main : surface.line}`, color: from === k ? accent.soft : ink.mid }}>
            {label}
          </ButtonBase>
        ))}
      </Box>
      <Box sx={{ ...typo.caption, color: ink.mid }}>
        {from === 'here' ? 'Копия получит план, кнопки и каналы; номера не копируются — их назначают заново.' : from === 'hotel' ? 'Каналы оборудования чужого отеля могут не совпасть с вашими — после копирования будет проверка.' : 'Шаблоны — типовые номера NaviRoom: «Стандарт», «Люкс», «Вилла».'}
        {from !== 'here' ? <> <Sample /></> : null}
      </Box>
    </MockAction>
  );
}

function VariantEditor({ v, onBack }: { v: MockVariant; onBack: () => void }) {
  const [params, go] = useGo();
  const step = (params.get('step') as StepKey) || 'base';
  return (
    <Box data-testid="sandbox-variant-editor">
      <Button size="small" sx={{ color: accent.soft, mb: 1, px: 0.5 }} onClick={onBack}>← Все варианты</Button>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }}>
        <Typography component="h2" sx={{ ...typo.pageTitle, color: ink.hi }}>{v.title}</Typography>
        <StatePill v={v} />
        {v.sample ? <Sample /> : null}
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '220px minmax(0,1fr)' }, alignItems: 'start' }}>
        <Box sx={{ ...panelSx, p: 0.75, display: 'grid', gap: 0.25 }} data-testid="sandbox-variant-steps">
          {STEPS.map((s, i) => (
            <ButtonBase key={s.key} onClick={() => go({ step: s.key })} sx={{ display: 'flex', gap: 1, justifyContent: 'flex-start', px: 1, py: 0.9, borderRadius: `${shape.radiusSmall}px`, bgcolor: step === s.key ? accent.washSoft : 'transparent', color: step === s.key ? accent.soft : ink.hi, ...typo.body, fontWeight: step === s.key ? 800 : 600 }}>
              <StepIcon done={v.steps[s.key]} />
              {i + 1}. {s.title}
            </ButtonBase>
          ))}
        </Box>
        <Panel title={STEPS.find((s) => s.key === step)?.title} aside={<Help>{STEPS.find((s) => s.key === step)?.help}</Help>}>
          <StepBody step={step} v={v} />
        </Panel>
      </Box>
    </Box>
  );
}

function StepBody({ step, v }: { step: StepKey; v: MockVariant }) {
  const [engineer, setEngineer] = useState(false);
  const [test, setTest] = useState(false);
  const metro = STAND_HOTELS.metropol.rooms;
  const [mask, setMask] = useState('…05');
  const matched = metro.filter((r) => mask.replace('…', '') && r.number.endsWith(mask.replace('…', '')));
  switch (step) {
    case 'base':
      return (
        <Box sx={{ display: 'grid', gap: 1.5, maxWidth: 520 }}>
          <TextField size="small" label="Название" defaultValue={v.title} sx={fieldSx} helperText="Как вариант называют в отеле: «Делюкс», «Люкс с террасой»." />
          <Box sx={{ p: 1.5, borderRadius: `${shape.radius}px`, border: `1px dashed ${surface.line}`, ...typo.caption, color: ink.mid }}>
            Файл пусконаладки (Excel) — по желанию. Из него подтянутся каналы оборудования и образцовый номер. <Button size="small" sx={secondaryButtonSx}>Выбрать файл…</Button>
          </Box>
        </Box>
      );
    case 'plan':
      return (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 240px' } }}>
          <PlanThumb zones={v.zones || 3} size={420} />
          <Box sx={{ display: 'grid', gap: 0.75, alignContent: 'start' }}>
            {['Спальня', 'Гостиная', 'Ванная', 'Прихожая'].slice(0, Math.max(v.zones, 2)).map((z) => (
              <Box key={z} sx={{ display: 'flex', justifyContent: 'space-between', p: 1, borderRadius: `${shape.radiusSmall}px`, border: `1px solid ${surface.hair}`, ...typo.body }}>
                {z} <Button size="small" sx={{ color: ink.mid, minWidth: 0 }}>Изменить</Button>
              </Box>
            ))}
            <Button size="small" sx={secondaryButtonSx}>+ Зона</Button>
          </Box>
        </Box>
      );
    case 'buttons':
      return (
        <Box sx={{ display: 'grid', gap: 1 }}>
          {[['Свет в спальне', 'Спальня'], ['Свет в гостиной', 'Гостиная'], ['Шторы', 'Спальня'], ['Климат', 'Весь номер'], ['Не беспокоить', 'Весь номер'], ['Убрать номер', 'Весь номер']].map(([b, z]) => (
            <Box key={b} sx={{ display: 'flex', gap: 1, alignItems: 'center', p: 1, borderRadius: `${shape.radiusSmall}px`, border: `1px solid ${surface.hair}` }}>
              <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi, flex: 1 }}>{b}</Box>
              <Box sx={{ ...typo.caption, color: ink.mid }}>{z}</Box>
              <Switch size="small" defaultChecked inputProps={{ 'aria-label': `Показывать гостю: ${b}` }} />
            </Box>
          ))}
          <ButtonBase onClick={() => setEngineer(!engineer)} sx={{ justifyContent: 'flex-start', ...typo.caption, fontWeight: 700, color: accent.soft, py: 0.5 }} data-testid="sandbox-engineer-toggle">
            {engineer ? '▾' : '▸'} Инженерный блок: каналы оборудования
          </ButtonBase>
          {engineer ? (
            <Box sx={{ p: 1, borderRadius: `${shape.radiusSmall}px`, bgcolor: surface.s2, ...typo.caption, color: ink.mid, display: 'grid', gap: 0.5 }} data-words="data">
              {(v.variables.length ? v.variables : [{ key: 'light_bedroom', command: 'Light.Bedroom.Set' }, { key: 'curtain_main', command: 'Curtain.Main.Set' }]).map((x) => (
                <Box key={x.key} sx={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace' }}>
                  <span>{x.key}</span>
                  <span>{x.command}</span>
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      );
    case 'rooms':
      return (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField size="small" label="Маска номера" value={mask} onChange={(e) => setMask(e.target.value)} sx={[fieldSx, { width: 160 }]} helperText="«…05» — все номера на 05" />
            {['2 этаж', '3 этаж', 'стояк 05', 'весь корпус'].map((c) => <Pill key={c} tone="muted">{c}</Pill>)}
          </Box>
          <Box sx={{ ...typo.body, color: ink.hi }} data-testid="sandbox-mask-count">
            Под маску попадает <b>{matched.length}</b> номеров Метрополя: {matched.slice(0, 8).map((r) => r.number).join(', ')}{matched.length > 8 ? '…' : ''}
          </Box>
          <Button sx={primaryButtonSx}>Привязать {matched.length} номеров</Button>
        </Box>
      );
    case 'check':
      return (
        <Box sx={{ display: 'grid', gap: 1.5, maxWidth: 520 }}>
          <TextField size="small" label="Номер для проверки" defaultValue="2205" sx={fieldSx} />
          <Box sx={{ ...typo.caption, color: ink.mid }}>Свет в спальне мигнёт два раза, шторы не двигаются. Номер должен быть свободен — проверьте занятость.</Box>
          <Button sx={primaryButtonSx} onClick={() => setTest(true)} data-testid="sandbox-run-test">Проверить номер</Button>
          {test ? (
            <MockAction title="Проверить номер 2205" onClose={() => setTest(false)} confirm="Проверить">
              <Box>В номере сейчас может быть гость: свет мигнёт у него. Продолжить?</Box>
            </MockAction>
          ) : null}
        </Box>
      );
    default:
      return (
        <Box sx={{ display: 'grid', gap: 1.25 }}>
          <Box sx={{ ...typo.body, color: ink.hi }}>Изменится у <b>{v.rooms || 0}</b> номеров. Черновик против текущей версии:</Box>
          {[['добавлено', 'Кнопка «Шторы» в спальне'], ['изменено', 'Зона «Гостиная» — новая граница'], ['убрано', 'Кнопка «Ночник»']].map(([k, t]) => (
            <Box key={t} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Pill tone={k === 'добавлено' ? 'ok' : k === 'убрано' ? 'bad' : 'warn'}>{k}</Pill>
              <Box sx={{ ...typo.body, color: ink.hi }}>{t}</Box>
            </Box>
          ))}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button sx={primaryButtonSx}>Опубликовать</Button>
            <Button sx={secondaryButtonSx}>Откатить к прошлой версии</Button>
          </Box>
        </Box>
      );
  }
}

/* ── Б: матрица ──────────────────────────────────────────────────────────── */

function Matrix({ variants }: { variants: MockVariant[] }) {
  const [params, go] = useGo();
  const open = variants.find((v) => v.code === params.get('variant'));
  const step = (params.get('step') as StepKey) || null;
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: open && step ? 'minmax(0,1fr) 440px' : '1fr' }, alignItems: 'start' }}>
      <Box sx={{ ...panelSx, p: 0, overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', ...typo.body, '& td, & th': { p: 1.1, borderBottom: `1px solid ${surface.hair}`, textAlign: 'center' } }} data-testid="sandbox-matrix">
          <Box component="thead">
            <Box component="tr" sx={{ '& th': { ...typo.label, color: ink.mid } }}>
              <Box component="th" sx={{ textAlign: 'start !important' }}>Вариант</Box>
              <th>Номеров</th>
              {STEPS.map((s) => <th key={s.key}>{s.title}</th>)}
              <th>Состояние</th>
            </Box>
          </Box>
          <Box component="tbody">
            {variants.map((v) => (
              <Box component="tr" key={v.code} sx={{ bgcolor: open?.code === v.code ? accent.washSoft : undefined }}>
                <Box component="td" sx={{ textAlign: 'start !important', fontWeight: 800, color: ink.hi, whiteSpace: 'nowrap' }}>
                  {v.title} {v.sample ? <Sample /> : null}
                </Box>
                <td>{v.rooms}</td>
                {STEPS.map((s) => (
                  <td key={s.key}>
                    <ButtonBase onClick={() => go({ variant: v.code, step: s.key })} data-testid={`sandbox-cell-${v.code}-${s.key}`} sx={{ borderRadius: '50%', p: 0.5, outline: open?.code === v.code && step === s.key ? `2px solid ${accent.main}` : 'none' }}>
                      <StepIcon done={v.steps[s.key]} />
                    </ButtonBase>
                  </td>
                ))}
                <td><StatePill v={v} /></td>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
      {open && step ? (
        <Panel title={`${open.title} · ${STEPS.find((s) => s.key === step)?.title}`} aside={<Button size="small" sx={{ color: ink.mid }} onClick={() => go({ variant: null, step: null })}>Закрыть</Button>}>
          <StepBody step={step} v={open} />
        </Panel>
      ) : null}
    </Box>
  );
}

/* ── В: от номеров ───────────────────────────────────────────────────────── */

function FromRooms({ variants }: { variants: MockVariant[] }) {
  const [params, go] = useGo();
  const hotel = STAND_HOTELS.sialia;
  const roomVariants = useMemo(() => [...new Set(hotel.rooms.map((r) => r.variant).filter(Boolean) as string[])].sort(naturalCompare), [hotel]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [assign, setAssign] = useState(false);
  const open = variants.find((v) => v.code === params.get('variant'));
  const toggle = (keys: string[]) =>
    setSel((prev) => {
      const next = new Set(prev);
      const all = keys.every((k) => next.has(k));
      for (const k of keys) {
        if (all) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '260px minmax(0,1fr)' }, alignItems: 'start' }}>
      <Panel title="Варианты" aside={<Help>Цвет варианта — тот же, что у номеров на схеме. Щёлкните вариант, чтобы открыть его настройку.</Help>}>
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          {roomVariants.map((name) => (
            <ButtonBase key={name} onClick={() => go({ variant: variants[0]?.code ?? null })} sx={{ display: 'flex', gap: 1, justifyContent: 'flex-start', p: 0.75, borderRadius: `${shape.radiusSmall}px`, ...typo.body }}>
              <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: paint({ ...hotel.rooms[0], variant: name, active: true }, 'variant', roomVariants).fill }} />
              <Box sx={{ flex: 1, textAlign: 'start', color: ink.hi }}>{name}</Box>
              <Box sx={{ ...typo.caption, color: ink.low }}>{hotel.rooms.filter((r) => r.variant === name).length}</Box>
            </ButtonBase>
          ))}
          <Box sx={{ display: 'flex', gap: 1, p: 0.75, ...typo.caption, color: ink.mid }}>
            <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: 'var(--adm-state-muted-wash)', border: `1px solid ${surface.line}` }} />
            без варианта · {hotel.rooms.filter((r) => !r.variant).length}
          </Box>
        </Box>
        <Box sx={{ ...typo.caption, color: ink.low, mt: 1 }}>
          Сиалия, снимок стенда: варианты разложены <Sample /> по категории.
        </Box>
      </Panel>
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        {layout(hotel.rooms).map((b) => {
          const roomsOf = [...b.at.values()];
          return (
            <Panel key={b.building} title={b.building} aside={<Button size="small" sx={secondaryButtonSx} onClick={() => toggle(roomsOf.map((r) => r.key))}>Весь корпус</Button>}>
              <Box sx={{ display: 'grid', gap: '4px' }}>
                {b.floors.map((f) => (
                  <Box key={f} sx={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <ButtonBase onClick={() => toggle(roomsOf.filter((r) => r.floor === f).map((r) => r.key))} sx={{ width: 40, ...typo.caption, fontWeight: 700, color: ink.mid }}>{f} эт.</ButtonBase>
                    {b.positions.map((p) => {
                      const room = b.at.get(`${f}|${p}`);
                      return room ? <VariantCell key={p} room={room} variants={roomVariants} selected={sel.has(room.key)} onClick={() => toggle([room.key])} /> : <Box key={p} sx={{ width: 40, height: 28 }} />;
                    })}
                  </Box>
                ))}
              </Box>
            </Panel>
          );
        })}
        {sel.size ? (
          <Box sx={{ ...panelSx, p: 1, display: 'flex', gap: 1, alignItems: 'center', border: `1px solid ${accent.main}`, position: 'sticky', bottom: 12 }} data-testid="sandbox-from-rooms-selection">
            <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi, px: 1 }}>Выбрано: {sel.size}</Box>
            <Button size="small" sx={primaryButtonSx} onClick={() => setAssign(true)}>Назначить вариант…</Button>
            <Box sx={{ flex: 1 }} />
            <Button size="small" sx={{ color: ink.mid }} onClick={() => setSel(new Set())}>Снять выбор</Button>
          </Box>
        ) : null}
        {open ? (
          <Panel title={`Вариант «${open.title}»`} aside={<Button size="small" sx={{ color: ink.mid }} onClick={() => go({ variant: null })}>Закрыть</Button>}>
            <Box sx={{ display: 'grid', gap: 1 }}>
              {STEPS.map((s) => (
                <Box key={s.key} sx={{ display: 'flex', gap: 1, alignItems: 'center', ...typo.body }}>
                  <StepIcon done={open.steps[s.key]} /> {s.title}
                </Box>
              ))}
            </Box>
          </Panel>
        ) : null}
      </Box>
      {assign ? (
        <MockAction title={`Назначить вариант — ${sel.size} номерам`} onClose={() => setAssign(false)} confirm="Назначить">
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{roomVariants.map((v) => <Pill key={v} tone="info">{v}</Pill>)}</Box>
          <Box sx={{ ...typo.caption, color: ink.mid }}>У номеров, где сейчас другой вариант, он сменится; опубликованная версия нового варианта начнёт действовать сразу.</Box>
        </MockAction>
      ) : null}
    </Box>
  );
}

function VariantCell({ room, variants, selected, onClick }: { room: MockRoom; variants: string[]; selected: boolean; onClick: () => void }) {
  return (
    <RoomTip room={room}>
      <ButtonBase
        onClick={onClick}
        data-testid={`sandbox-vroom-${room.number}`}
        sx={{ width: 40, height: 28, borderRadius: '5px', bgcolor: paint(room, 'variant', variants).fill, fontSize: 9.5, fontWeight: 800, color: ink.hi, outline: selected ? `2px solid ${accent.main}` : `1px solid ${surface.line}`, outlineOffset: selected ? 1 : -1 }}
      >
        {room.number.length > 5 ? room.number.split(/[-\s]/).pop() : room.number}
      </ButtonBase>
    </RoomTip>
  );
}
