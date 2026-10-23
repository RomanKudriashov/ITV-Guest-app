import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Collapse from '@mui/material/Collapse';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import { useTranslation } from 'react-i18next';

import { queryKeys } from '@/api/queryKeys';
import { fetchPlan, type GrmsType, type PlanState, type TypeStatus, type VersionRecord } from '@/api/grms';
import { SelectField } from '@/components/SelectField';
import { BuilderTab } from '@/cms/roomControl/BuilderTab';
import { ImportTab } from '@/cms/roomControl/ImportTab';
import { PlanEditor } from '@/cms/roomControl/PlanEditor';
import { VersionsTab } from '@/cms/roomControl/VersionsTab';
import { useGrms, useGrmsScope } from '@/cms/roomControl/scope';
import { accent, fieldSx, ink, panelSx, primaryButtonSx, quietButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../../adminTokens';
import {
  getConnection,
  getRoomsMap,
  getVariantDiff,
  getVariants,
  readRoomState,
  type ConnectionState,
  type RoomRead,
  type VariantCard,
  type VariantChange,
  type VariantsOverview,
} from '../../adminClient';
import { useRights } from '../../useRights';
import { Help, Panel, Pill, type Tone } from '../hotels/hotelsUi';
import { BuildingScheme, highlightSx, useSwatches } from './roomsMap';

/**
 * ВАРИАНТЫ НОМЕРОВ (партия 63-4, макет 63-М «Варианты номеров» А).
 *
 * Вариант — одна настройка (план, зоны, кнопки для гостя, каналы оборудования),
 * которая применяется сразу ко многим одинаковым номерам. Вместо четырёх
 * вкладок по видам работы (импорт, конструктор, план, версии) — варианты и
 * шаги внутри каждого.
 *
 * Шаг A — только чтение: каждый шаг показывает текущие данные словами. Правка
 * пока — прежними экранами за кнопкой «Править (прежний экран)»; её заменит
 * шаг B.
 */

const STEPS = ['base', 'plan', 'buttons', 'rooms', 'check', 'publish'] as const;
export type VariantStep = (typeof STEPS)[number];
type Mark = 'ready' | 'attention' | 'todo';
const MARK_TONE: Record<Mark, Tone> = { ready: 'ok', attention: 'warn', todo: 'muted' };
const STATE_TONE: Record<VariantCard['state'], Tone> = { published: 'ok', changed: 'warn', unpublished: 'warn', empty: 'muted' };

/** Прежние подвкладки (`sub`) — на шаг варианта; диагностика — в «Журнал». */
export const LEGACY_SUB: Record<string, VariantStep | 'journal'> = {
  import: 'base',
  builder: 'buttons',
  plan: 'plan',
  versions: 'publish',
  diagnostics: 'journal',
};

const pick = (title: Record<string, string> | undefined, lang: string) => (title ? title[lang] || title.ru || Object.values(title)[0] || '' : '');

/** Образец второго варианта — только в разработке, чтобы был виден список. */
const SAMPLE: VariantCard = {
  code: '__sample__',
  title: { ru: 'Стандарт', en: 'Standard', zh: '标准间', ar: 'قياسية' },
  notes: '',
  plan_level: 'tiles',
  thumb: null,
  rooms: 0,
  room_ids: [],
  state: 'empty',
  elements: 0,
  publishable: 0,
  hidden: 0,
  zones: 0,
  version: null,
  published_at: null,
  has_plan: false,
  sample: true,
};

export function VariantsScreen({ hotelId, types, onTypesChanged }: { hotelId: string; types: GrmsType[]; onTypesChanged: () => void }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const overview = useQuery({ queryKey: ['admin', 'variants', hotelId], queryFn: () => getVariants(hotelId) });
  const conn = useQuery({ queryKey: ['admin', 'connection', hotelId], queryFn: () => getConnection(hotelId) });
  const code = params.get('variant');
  const go = (next: Record<string, string | null>) => {
    const out = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null) out.delete(k);
      else out.set(k, v);
    }
    setParams(out, { replace: true });
  };
  if (overview.isLoading) return <Skeleton variant="rounded" height={320} />;
  if (!overview.data) return null;
  const data = overview.data;
  const list = import.meta.env.DEV && data.variants.length < 2 ? [...data.variants, SAMPLE] : data.variants;
  const open = data.variants.find((v) => v.code === code);
  const type = types.find((x) => x.code === code);
  return (
    <Box sx={{ display: 'grid', gap: 2 }} data-testid="admin-variants">
      <Path data={data} conn={conn.data} onGo={(tab) => go({ tab, variant: null, step: null })} />
      {open && type ? (
        <Variant
          hotelId={hotelId}
          v={open}
          type={type}
          types={types}
          origin={data.origin}
          step={(STEPS as readonly string[]).includes(params.get('step') ?? '') ? (params.get('step') as VariantStep) : 'base'}
          onStep={(step) => go({ step })}
          onBack={() => go({ variant: null, step: null })}
          onTypesChanged={() => {
            onTypesChanged();
            void overview.refetch();
          }}
        />
      ) : (
        <Panel title={t('admin.variants.listTitle')} aside={<Help>{t('admin.variants.idea')}</Help>}>
          <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1.5 }}>{t('admin.variants.ideaShort')}</Typography>
          {list.length ? (
            <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
              {list.map((v) => (
                <VariantCardView key={v.code} v={v} onOpen={() => go({ variant: v.code, step: 'base' })} />
              ))}
            </Box>
          ) : (
            <Box sx={{ ...typo.body, color: ink.mid }} data-testid="admin-variants-none">{t('admin.variants.none')}</Box>
          )}
          {/* Старые редакторы до шага B: импорт — единственный путь завести вариант. */}
          <LegacyImport onImported={() => { onTypesChanged(); void overview.refetch(); }} />
        </Panel>
      )}
    </Box>
  );
}

/* ── Обзор-путь: Подключение → Варианты → Номера → Опубликовано ─────────── */

function Path({ data, conn, onGo }: { data: VariantsOverview; conn: ConnectionState | undefined; onGo: (tab: string) => void }) {
  const { t } = useTranslation();
  const k = 'admin.variants.path';
  const n = data.variants.length;
  const configured = data.variants.filter((v) => v.state !== 'empty').length;
  const total = data.rooms.total;
  const bound = data.rooms.with_variant;
  const connTone: Tone = !conn ? 'muted' : conn.connector.state === 'online' && conn.server_link.state === 'ok' ? 'ok' : conn.connector.state === 'online' && conn.server_link.state === 'unknown' ? 'warn' : 'bad';
  const connWhy = !conn
    ? ''
    : conn.connector.state === 'none'
      ? t(`${k}.why.noConnector`)
      : conn.connector.state !== 'online'
        ? t(`${k}.why.connectorSilent`)
        : conn.server_link.state === 'down'
          ? t(`${k}.why.serverDown`)
          : '';
  const unpublished = data.variants.filter((v) => v.state === 'unpublished' || v.state === 'empty').length;
  const nodes: Array<{ key: string; tone: Tone; value: string; why: string; tab?: string }> = [
    { key: 'connection', tone: connTone, value: conn ? (connTone === 'ok' ? t(`${k}.connOk`) : t(`admin.card.conn.connector.${conn.connector.state}`)) : '…', why: connWhy, tab: 'connections' },
    {
      key: 'variants',
      tone: !n ? 'bad' : configured < n ? 'warn' : 'ok',
      value: t(`${k}.variantsValue`, { count: n }),
      why: !n ? t(`${k}.why.noVariants`) : configured < n ? t(`${k}.why.emptyVariants`, { count: n - configured }) : '',
    },
    {
      key: 'rooms',
      tone: !total || !bound ? 'bad' : bound < total ? 'warn' : 'ok',
      value: t(`${k}.roomsValue`, { bound, total }),
      why: !total ? t(`${k}.why.noRooms`) : bound < total ? t(`${k}.why.roomsWithout`, { count: total - bound }) : '',
      tab: 'rooms',
    },
    {
      key: 'published',
      tone: !n || data.published === 0 ? 'bad' : data.changed || unpublished ? 'warn' : 'ok',
      value: data.published === n && n ? t(`${k}.publishedAll`) : t(`${k}.publishedValue`, { count: data.published, total: n }),
      why: data.changed ? t(`${k}.why.changed`, { count: data.changed }) : unpublished ? t(`${k}.why.unpublished`, { count: unpublished }) : '',
    },
  ];
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(0, 1fr))' }, gap: 1.25 }} data-testid="admin-variants-path">
      {nodes.map((node, i) => (
        <ButtonBase
          key={node.key}
          disabled={!node.tab}
          onClick={() => node.tab && onGo(node.tab)}
          data-testid={`admin-variants-path-${node.key}`}
          data-tone={node.tone}
          sx={{
            ...panelSx,
            p: 1.5,
            display: 'grid',
            gap: 0.4,
            justifyItems: 'start',
            justifyContent: 'stretch',
            alignContent: 'start',
            textAlign: 'start',
            position: 'relative',
            borderTop: `3px solid ${node.tone === 'muted' ? surface.line : state[node.tone as 'ok']}`,
            '&::after': i < nodes.length - 1 ? { content: '"→"', position: 'absolute', right: -14, top: '38%', color: ink.low, fontWeight: 800, display: { xs: 'none', md: 'block' } } : {},
          }}
        >
          <Box sx={{ ...typo.label, color: ink.mid }}>{`${i + 1}. ${t(`${k}.${node.key}`)}`}</Box>
          <Box sx={{ ...typo.body, fontWeight: 800, color: node.tone === 'muted' ? ink.hi : state[node.tone as 'ok'] }}>{node.value}</Box>
          {node.why ? <Box sx={{ ...typo.caption, color: ink.mid }}>{node.why}</Box> : null}
        </ButtonBase>
      ))}
    </Box>
  );
}

/* ── Карточка варианта в списке ─────────────────────────────────────────── */

function VariantCardView({ v, onOpen }: { v: VariantCard; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const k = 'admin.variants';
  return (
    <Box sx={{ ...panelSx, p: 0, overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr' }} data-testid={`admin-variant-${v.sample ? 'sample' : v.code}`} data-state={v.state}>
      <Box sx={{ height: 150, bgcolor: surface.s2, display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden', borderBottom: `1px solid ${surface.hair}` }}>
        {v.thumb ? (
          <Box component="img" src={v.thumb} alt="" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Box sx={{ display: 'grid', justifyItems: 'center', gap: 0.5, color: ink.low }}>
            <GridViewOutlinedIcon />
            <Box sx={{ ...typo.caption }}>{t(`${k}.noThumb.${v.plan_level}`)}</Box>
          </Box>
        )}
        {v.sample ? (
          <Box sx={{ position: 'absolute', top: 8, insetInlineStart: 8 }}>
            <Pill tone="gold">{t(`${k}.sample`)}</Pill>
          </Box>
        ) : null}
      </Box>
      <Box sx={{ p: 1.5, display: 'grid', gap: 0.75, alignContent: 'start' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ ...typo.panelTitle, color: ink.hi, flex: 1, minWidth: 0 }} data-words="data">{pick(v.title, i18n.language) || t(`${k}.untitled`)}</Typography>
          <Pill tone={STATE_TONE[v.state]} testId={`admin-variant-state-${v.sample ? 'sample' : v.code}`}>{t(`${k}.state.${v.state}`)}</Pill>
        </Box>
        <Box sx={{ ...typo.caption, color: ink.mid }}>
          {v.sample ? t(`${k}.sampleHint`) : `${t(`${k}.roomsCount`, { count: v.rooms })} · ${t(`${k}.buttonsCount`, { count: v.publishable })} · ${t(`${k}.view.${v.plan_level}`)}`}
        </Box>
        <Box>
          <Button size="small" sx={secondaryButtonSx} disabled={v.sample} onClick={onOpen} data-testid={`admin-variant-open-${v.sample ? 'sample' : v.code}`}>
            {t(`${k}.open`)}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

/* ── Вариант: шаги слева, данные справа ─────────────────────────────────── */

function Variant({
  hotelId,
  v,
  type,
  types,
  origin,
  step,
  onStep,
  onBack,
  onTypesChanged,
}: {
  hotelId: string;
  v: VariantCard;
  type: GrmsType;
  types: GrmsType[];
  origin: VariantsOverview['origin'];
  step: VariantStep;
  onStep: (step: VariantStep) => void;
  onBack: () => void;
  onTypesChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const grms = useGrms();
  const { transport } = useGrmsScope();
  const phone = useMediaQuery('(max-width:899px)');
  const status = useQuery({ queryKey: queryKeys.grmsStatus(grms.base, v.code), queryFn: () => grms.status(v.code) });
  const plan = useQuery({ queryKey: queryKeys.grmsPlan(grms.base, v.code), queryFn: () => fetchPlan(transport, v.code) });
  const [check, setCheck] = useState<RoomRead | null>(null);
  const k = 'admin.variants';

  const marks: Record<VariantStep, Mark> = {
    base: pick(v.title, 'ru') ? 'ready' : 'attention',
    plan: v.plan_level === 'tiles' ? 'ready' : plan.data?.frames.lit && plan.data.geometry.zones?.length ? 'ready' : plan.data?.frames.lit ? 'attention' : 'todo',
    buttons: !v.elements ? 'todo' : v.hidden ? 'attention' : 'ready',
    rooms: v.rooms ? 'ready' : 'todo',
    check: check ? (check.ok ? 'ready' : 'attention') : 'todo',
    publish: v.state === 'published' ? 'ready' : v.state === 'empty' ? 'todo' : 'attention',
  };

  const nav = (
    <Box
      component="nav"
      aria-label={t(`${k}.stepsLabel`)}
      sx={phone ? { display: 'flex', gap: 0.75, overflowX: 'auto', pb: 0.5 } : { display: 'grid', gap: 0.5, alignContent: 'start', position: 'sticky', top: 12 }}
      data-testid="admin-variant-steps"
    >
      {STEPS.map((s, i) => (
        <ButtonBase
          key={s}
          onClick={() => onStep(s)}
          aria-current={s === step ? 'step' : undefined}
          data-testid={`admin-variant-step-${s}`}
          data-mark={marks[s]}
          sx={{
            justifyContent: 'flex-start',
            gap: 1,
            px: 1.25,
            py: 1,
            borderRadius: `${shape.radiusSmall}px`,
            textAlign: 'start',
            flex: 'none',
            border: `1px solid ${s === step ? accent.main : surface.line}`,
            bgcolor: s === step ? accent.washSoft : 'transparent',
          }}
        >
          <Box component="span" aria-hidden sx={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, flex: 'none', color: marks[s] === 'todo' ? ink.mid : '#fff', bgcolor: marks[s] === 'ready' ? state.ok : marks[s] === 'attention' ? state.warn : surface.s3 }}>
            {marks[s] === 'ready' ? '✓' : marks[s] === 'attention' ? '!' : i + 1}
          </Box>
          <Box sx={{ display: 'grid' }}>
            <Box component="span" sx={{ ...typo.body, fontWeight: 700, color: ink.hi, whiteSpace: 'nowrap' }}>{t(`${k}.steps.${s}`)}</Box>
            {!phone ? <Box component="span" sx={{ ...typo.caption, color: ink.mid }}>{t(`${k}.mark.${marks[s]}`)}</Box> : null}
          </Box>
        </ButtonBase>
      ))}
    </Box>
  );

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }} data-testid={`admin-variant-view-${v.code}`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" sx={quietButtonSx} startIcon={<ArrowBackIcon fontSize="small" />} onClick={onBack} data-testid="admin-variant-back">
          {t(`${k}.back`)}
        </Button>
        <Typography component="h2" sx={{ ...typo.pageTitle, fontSize: 22, color: ink.hi }} data-words="data">{pick(v.title, i18n.language) || t(`${k}.untitled`)}</Typography>
        <Pill tone={STATE_TONE[v.state]}>{t(`${k}.state.${v.state}`)}</Pill>
        <Box sx={{ ...typo.caption, color: ink.mid }}>{t(`${k}.roomsCount`, { count: v.rooms })}</Box>
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: phone ? '1fr' : '230px minmax(0, 1fr)', alignItems: 'start' }}>
        {nav}
        <Box sx={{ ...panelSx, minWidth: 0 }} data-testid={`admin-variant-pane-${step}`}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <Typography component="h3" sx={{ ...typo.panelTitle, color: ink.hi, flex: 1 }}>{`${STEPS.indexOf(step) + 1}. ${t(`${k}.steps.${step}`)}`}</Typography>
            <Pill tone={MARK_TONE[marks[step]]}>{t(`${k}.mark.${marks[step]}`)}</Pill>
          </Box>
          {step === 'base' ? <BaseStep v={v} origin={origin} onTypesChanged={onTypesChanged} /> : null}
          {step === 'plan' ? <PlanStep v={v} plan={plan.data} status={status.data} types={types} /> : null}
          {step === 'buttons' ? <ButtonsStep v={v} status={status.data} type={type} /> : null}
          {step === 'rooms' ? <RoomsStep hotelId={hotelId} v={v} /> : null}
          {step === 'check' ? <CheckStep hotelId={hotelId} v={v} result={check} onResult={setCheck} /> : null}
          {step === 'publish' ? <PublishStep hotelId={hotelId} v={v} type={type} /> : null}
        </Box>
      </Box>
    </Box>
  );
}

function Fact({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '200px 1fr' }, gap: { xs: 0.25, sm: 2 }, py: 0.9, borderBottom: `1px solid ${surface.hair}` }}>
      <Box sx={{ ...typo.caption, color: ink.mid, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {label}
        {help ? <Help>{help}</Help> : null}
      </Box>
      <Box sx={{ ...typo.body, color: ink.hi, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</Box>
    </Box>
  );
}

/** Прежний редактор под кнопкой — до шага B, только с правом правки. */
function Legacy({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  const { t } = useTranslation();
  const { canWrite } = useRights();
  const [open, setOpen] = useState(false);
  if (!canWrite) return null;
  return (
    <Box sx={{ mt: 2, pt: 1.5, borderTop: `1px dashed ${surface.line}` }}>
      <Button size="small" sx={quietButtonSx} onClick={() => setOpen((x) => !x)} data-testid={testId}>
        {open ? t('admin.variants.legacyHide') : `${t('admin.variants.legacy')} · ${label}`}
      </Button>
      {open ? <Box sx={{ mt: 1.5 }}>{children}</Box> : null}
    </Box>
  );
}

function LegacyImport({ onImported }: { onImported: () => void }) {
  const { t } = useTranslation();
  return (
    <Legacy label={t('admin.variants.legacyImport')} testId="admin-variant-legacy-import">
      <ImportTab onImported={onImported} />
    </Legacy>
  );
}

/* 1) Основа */

function BaseStep({ v, origin, onTypesChanged }: { v: VariantCard; origin: VariantsOverview['origin']; onTypesChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const k = 'admin.variants.base';
  const ORDER = ['ru', 'en', 'zh', 'ar'];
  const langs = Object.entries(v.title)
    .filter(([, value]) => value)
    .sort(([a], [b]) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  return (
    <Box>
      <Fact label={t(`${k}.title`)} help={t(`${k}.titleHelp`)}>
        <Box sx={{ display: 'grid', gap: 0.25 }}>
          {langs.length ? (
            langs.map(([lang, value]) => (
              <Box key={lang}>
                <Box component="span" sx={{ color: ink.mid }}>{t(`admin.variants.lang.${lang}`, { defaultValue: t('admin.variants.lang.other') })}: </Box>
                <span data-words="data">{value}</span>
              </Box>
            ))
          ) : (
            <Box sx={{ color: state.warn }}>{t(`${k}.noTitle`)}</Box>
          )}
        </Box>
      </Fact>
      <Fact label={t(`${k}.notes`)}>{v.notes ? <span data-words="data">{v.notes}</span> : <Box component="span" sx={{ color: ink.mid }}>{t(`${k}.noNotes`)}</Box>}</Fact>
      <Fact label={t(`${k}.view`)} help={t(`${k}.viewHelp`)}>
        <b>{t(`admin.variants.view.${v.plan_level}`)}</b> — {t(`${k}.viewAbout.${v.plan_level}`)}
      </Fact>
      <Fact label={t(`${k}.origin`)} help={t(`${k}.originHelp`)}>
        {origin.kind === 'import' ? (
          <>
            {t(`${k}.fromImport`, { date: origin.at ? new Date(origin.at).toLocaleString(i18n.language) : '—' })}
            {origin.file ? (
              <>
                {' · '}
                <span data-words="data">{origin.file}</span>
              </>
            ) : null}
          </>
        ) : (
          t(`${k}.manual`)
        )}
      </Fact>
      <LegacyImport onImported={onTypesChanged} />
    </Box>
  );
}

/* 2) План */

function PlanStep({ v, plan, status, types }: { v: VariantCard; plan: PlanState | undefined; status: TypeStatus | undefined; types: GrmsType[] }) {
  const { t, i18n } = useTranslation();
  const k = 'admin.variants.plan';
  if (!plan) return <Skeleton variant="rounded" height={240} />;
  const g = plan.geometry;
  const zoneTitle = (code: string) => pick(status?.zones.find((z) => z.code === code)?.title, i18n.language) || t(`${k}.zoneUnnamed`);
  const frame = plan.frames.lit;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {v.plan_level === 'tiles' ? <Box sx={{ ...typo.body, color: ink.mid }}>{t(`${k}.tiles`)}</Box> : null}
      {frame ? (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 3fr) minmax(0, 2fr)' }, alignItems: 'start' }}>
          <Box sx={{ position: 'relative', borderRadius: `${shape.radiusSmall}px`, overflow: 'hidden', bgcolor: surface.s2 }} data-testid="admin-variant-plan-frame">
            <Box component="img" src={frame.url} alt="" sx={{ display: 'block', width: '100%' }} />
            {(g.zones ?? []).map((zone) => (
              <Box
                key={zone.code}
                title={zoneTitle(zone.code)}
                sx={{
                  position: 'absolute',
                  left: `${zone.hit.x}%`,
                  top: `${zone.hit.y}%`,
                  width: `${zone.hit.w}%`,
                  height: `${zone.hit.h}%`,
                  border: `2px solid ${accent.main}`,
                  bgcolor: `color-mix(in srgb, ${accent.main} 14%, transparent)`,
                  borderRadius: '6px',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Box sx={{ ...typo.caption, fontWeight: 800, color: '#fff', bgcolor: accent.main, px: 0.75, borderRadius: '4px' }}>{zoneTitle(zone.code)}</Box>
              </Box>
            ))}
          </Box>
          <Box>
            <Fact label={t(`${k}.frame`)}>{plan.frames.off ? t(`${k}.framePair`) : t(`${k}.frameOne`)}</Fact>
            <Fact label={t(`${k}.zones`)} help={t(`${k}.zonesHelp`)}>
              {(g.zones ?? []).length ? (g.zones ?? []).map((z) => zoneTitle(z.code)).join(', ') : <Box component="span" sx={{ color: state.warn }}>{t(`${k}.noZones`)}</Box>}
            </Fact>
            <Fact label={t(`${k}.windows`)}>{t(`${k}.count`, { count: (g.windows ?? []).length })}</Fact>
            <Fact label={t(`${k}.points`)} help={t(`${k}.pointsHelp`)}>{t(`${k}.count`, { count: (g.points ?? []).length })}</Fact>
          </Box>
        </Box>
      ) : v.plan_level !== 'tiles' ? (
        <Box sx={{ ...typo.body, color: state.warn }}>{t(`${k}.noFrame`)}</Box>
      ) : null}
      <Legacy label={t(`${k}.legacy`)} testId="admin-variant-legacy-plan">
        <PlanEditor code={v.code} types={types} />
      </Legacy>
    </Box>
  );
}

/* 3) Кнопки для гостя */

function ButtonsStep({ v, status, type }: { v: VariantCard; status: TypeStatus | undefined; type: GrmsType }) {
  const { t, i18n } = useTranslation();
  const k = 'admin.variants.buttons';
  const [engineer, setEngineer] = useState(false);
  if (!status) return <Skeleton variant="rounded" height={200} />;
  const label = (el: TypeStatus['elements'][number]) => pick(el.title, i18n.language) || t(`admin.variants.kind.${el.kind}`, { defaultValue: t('admin.variants.kind.other') });
  const zones = [...status.zones].sort((a, b) => a.sort_order - b.sort_order);
  const groups = [...zones.map((z) => ({ code: z.code, title: pick(z.title, i18n.language) })), { code: '', title: t(`${k}.noZone`) }]
    .map((z) => ({ ...z, items: status.elements.filter((el) => (el.zone || '') === z.code) }))
    .filter((z) => z.items.length);
  const vars = new Map(type.variables.map((x) => [x.key, x]));
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {!status.elements.length ? <Box sx={{ ...typo.body, color: ink.mid }}>{t(`${k}.none`)}</Box> : null}
      <Box sx={{ display: 'grid', gap: 0.75 }} data-testid="admin-variant-buttons">
        {groups.map((z) => (
          <Box key={z.code || '-'} sx={{ ...typo.body, color: ink.hi }} data-testid={`admin-variant-zone-${z.code || 'none'}`}>
            <b data-words="data">{z.title}</b>:{' '}
            {z.items.map((el, i) => (
              <Box component="span" key={el.slug} sx={{ color: el.publishable ? ink.hi : state.warn }}>
                {i ? ', ' : ''}
                <span data-words="data">{label(el)}</span>
                {!el.publishable ? ` (${t(`${k}.hiddenShort`)})` : ''}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
      {v.hidden ? <Box sx={{ ...typo.caption, color: state.warn }}>{t(`${k}.hidden`, { count: v.hidden })}</Box> : null}
      <Box>
        <Button size="small" sx={quietButtonSx} onClick={() => setEngineer((x) => !x)} aria-expanded={engineer} data-testid="admin-variant-engineer">
          {engineer ? t(`${k}.engineerHide`) : t(`${k}.engineer`)}
        </Button>
        <Help>{t(`${k}.engineerHelp`)}</Help>
      </Box>
      <Collapse in={engineer} unmountOnExit>
        {/* Для инженера каналы оборудования — как есть: имена тегов и есть его язык. */}
        <Box sx={{ overflowX: 'auto' }} data-words="data" data-testid="admin-variant-engineer-table">
          <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', ...typo.caption, '& td, & th': { borderBottom: `1px solid ${surface.hair}`, p: 0.75, textAlign: 'start', verticalAlign: 'top' }, '& th': { color: ink.mid, fontWeight: 700 } }}>
            <thead>
              <tr>
                <th>{t(`${k}.col.button`)}</th>
                <th>{t(`${k}.col.ability`)}</th>
                <th>{t(`${k}.col.command`)}</th>
                <th>{t(`${k}.col.feedback`)}</th>
                <th>{t(`${k}.col.range`)}</th>
              </tr>
            </thead>
            <tbody>
              {status.elements.flatMap((el) =>
                (el.bindings.length ? el.bindings : [{ capability: '', variable: '' }]).map((b, i) => {
                  const variable = vars.get(b.variable);
                  return (
                    <tr key={`${el.slug}-${i}`}>
                      <td>{i === 0 ? `${label(el)} · ${el.slug}` : ''}{i === 0 && el.problems.length ? <Box sx={{ color: state.warn }}>{el.problems.join('; ')}</Box> : null}</td>
                      <td>{b.capability || '—'}</td>
                      <td>{variable?.command || '—'}</td>
                      <td>{variable?.feedback || '—'}</td>
                      <td>{variable ? `${variable.min_value}…${variable.max_value}` : '—'}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </Box>
          <Box sx={{ ...typo.caption, color: ink.mid, mt: 1 }}>{`${t(`${k}.device`)} ${type.device_name_template || '—'}`}</Box>
        </Box>
      </Collapse>
      <Legacy label={t(`${k}.legacy`)} testId="admin-variant-legacy-buttons">
        <BuilderTab type={type} />
      </Legacy>
    </Box>
  );
}

/* 4) Номера */

function RoomsStep({ hotelId, v }: { hotelId: string; v: VariantCard }) {
  const { t } = useTranslation();
  const k = 'admin.variants.rooms';
  const map = useQuery({ queryKey: ['admin', 'hotel-rooms-map', hotelId, { variants: '1' }], queryFn: () => getRoomsMap(hotelId, {}) });
  const rooms = useMemo(() => (map.data?.buildings ?? []).flatMap((b) => b.floors.flatMap((f) => f.rooms)), [map.data]);
  const swatches = useSwatches(rooms);
  if (!map.data) return <Skeleton variant="rounded" height={240} />;
  const mine = rooms.filter((r) => r.variant?.code === v.code);
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Box sx={{ ...typo.body, color: ink.hi }} data-testid="admin-variant-rooms-summary">
        {t(`${k}.summary`, { count: mine.length, total: rooms.length })}
        <Help>{t(`${k}.help`)}</Help>
      </Box>
      {mine.length ? (
        <Box sx={{ ...typo.caption, color: ink.mid }} data-words="data">{mine.map((r) => r.number).join(', ')}</Box>
      ) : null}
      <Box sx={{ display: 'grid', gap: 2, ...highlightSx(`v:${v.code}`) }} data-testid="admin-variant-rooms-scheme">
        {map.data.buildings.map((building) => (
          <Box key={building.key}>
            <Box sx={{ ...typo.label, color: ink.mid, mb: 0.75 }} data-words="data">{building.title || t('admin.card.rooms.noBuilding')}</Box>
            <BuildingScheme building={building} layer="variant" swatches={swatches} tile="a" zoom={0} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/* 5) Проверка — только чтение */

function CheckStep({ hotelId, v, result, onResult }: { hotelId: string; v: VariantCard; result: RoomRead | null; onResult: (r: RoomRead) => void }) {
  const { t } = useTranslation();
  const { canWrite } = useRights();
  const k = 'admin.variants.check';
  const map = useQuery({ queryKey: ['admin', 'hotel-rooms-map', hotelId, { variants: '1' }], queryFn: () => getRoomsMap(hotelId, {}) });
  const mine = useMemo(() => (map.data?.buildings ?? []).flatMap((b) => b.floors.flatMap((f) => f.rooms)).filter((r) => r.variant?.code === v.code), [map.data, v.code]);
  const [roomId, setRoomId] = useState('');
  const chosen = roomId || mine[0]?.id || '';
  const read = useMutation({ mutationFn: () => readRoomState(hotelId, chosen), onSuccess: onResult });
  const reasons: Record<string, string> = { NO_ROOM: 'no_room', NO_ROOM_TYPE: 'no_type', NO_PUBLISHED_CONFIG: 'no_config' };
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Box sx={{ ...typo.body, color: ink.mid }}>{t(`${k}.lead`)}</Box>
      {!mine.length ? <Box sx={{ ...typo.body, color: state.warn }}>{t(`${k}.noRooms`)}</Box> : null}
      {mine.length && canWrite ? (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Box sx={{ minWidth: 200 }}>
            <SelectField label={t('admin.card.rooms.col.number')} value={chosen} onChange={setRoomId} options={mine.map((r) => ({ value: r.id, label: r.number }))} testId="admin-variant-check-room" fieldSx={fieldSx} />
          </Box>
          <Button sx={primaryButtonSx} disabled={!chosen || read.isPending} onClick={() => read.mutate()} data-testid="admin-variant-check-read">
            {read.isPending ? t('admin.card.conn.wiz.reading') : t('admin.card.conn.wiz.read')}
          </Button>
        </Box>
      ) : null}
      {mine.length && !canWrite ? <Box sx={{ ...typo.caption, color: ink.mid }}>{t(`${k}.readOnly`)}</Box> : null}
      {result ? (
        <Box sx={{ ...typo.body, color: result.ok ? state.ok : state.bad, display: 'grid', gap: 0.5 }} data-testid="admin-variant-check-result" data-ok={result.ok ? 'true' : 'false'}>
          <b>
            {result.ok
              ? t('admin.card.conn.wiz.readOk', { answered: result.answered, read: result.read })
              : t(`admin.card.conn.wiz.readReason.${reasons[result.reason] ?? result.reason}`, { defaultValue: t('admin.card.conn.wiz.readReason.other') })}
          </b>
          {result.ok && Object.keys(result.values).length ? (
            <Box sx={{ ...typo.caption, color: ink.mid }} data-words="data">
              {Object.entries(result.values).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}
            </Box>
          ) : null}
          <Box sx={{ ...typo.caption, color: ink.mid }}>{t('admin.card.conn.wiz.readSafe')}</Box>
        </Box>
      ) : null}
      {read.isError ? <Typography sx={{ ...typo.caption, color: state.bad }}>{String((read.error as Error).message)}</Typography> : null}
    </Box>
  );
}

/* 6) Публикация */

function PublishStep({ hotelId, v, type }: { hotelId: string; v: VariantCard; type: GrmsType }) {
  const { t, i18n } = useTranslation();
  const grms = useGrms();
  const { canWrite } = useRights();
  const k = 'admin.variants.publish';
  const diff = useQuery({ queryKey: ['admin', 'variant-diff', hotelId, v.code], queryFn: () => getVariantDiff(hotelId, v.code) });
  const versions = useQuery({ queryKey: queryKeys.grmsVersions(grms.base, v.code), queryFn: () => grms.versions(v.code) });
  const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(i18n.language) : '—');
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box>
        <Fact label={t(`${k}.current`)}>
          {v.version ? t(`${k}.version`, { version: v.version, date: when(v.published_at) }) : <Box component="span" sx={{ color: ink.mid }}>{t(`${k}.never`)}</Box>}
        </Fact>
      </Box>
      <Box data-testid="admin-variant-diff">
        <Box sx={{ ...typo.label, color: ink.mid, mb: 0.75, display: 'flex', gap: 0.5, alignItems: 'center' }}>
          {t(`${k}.diffTitle`)}
          <Help>{t(`${k}.diffHelp`)}</Help>
        </Box>
        {!diff.data ? (
          <Skeleton variant="rounded" height={60} />
        ) : diff.data.same ? (
          <Box sx={{ ...typo.body, color: state.ok }} data-testid="admin-variant-diff-same">{t(`${k}.same`)}</Box>
        ) : (
          <Box sx={{ display: 'grid', gap: 0.5 }}>
            <Box sx={{ ...typo.body, fontWeight: 700, color: state.warn }}>{t(`${k}.willChange`, { count: diff.data.rooms })}</Box>
            {diff.data.changes.map((c, i) => (
              <Box key={i} sx={{ ...typo.body, color: ink.hi }} data-testid={`admin-variant-change-${c.what}`}>
                • <ChangeLine c={c} />
              </Box>
            ))}
          </Box>
        )}
      </Box>
      <Box>
        <Box sx={{ ...typo.label, color: ink.mid, mb: 0.75 }}>{t(`${k}.history`)}</Box>
        {(versions.data?.versions ?? []).length ? (
          <Box sx={{ display: 'grid', gap: 0.5 }} data-testid="admin-variant-versions">
            {(versions.data?.versions ?? []).slice(0, 8).map((ver: VersionRecord) => (
              <Box key={ver.version} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', ...typo.body, color: ink.hi, py: 0.5, borderBottom: `1px solid ${surface.hair}` }}>
                <b>{t(`${k}.v`, { version: ver.version })}</b>
                <Box component="span" sx={{ color: ink.mid }}>{when(ver.published_at)}</Box>
                <Box component="span" sx={{ color: ink.mid }}>{t(`${k}.controls`, { count: ver.controls })}</Box>
                {ver.rolled_back_from ? <Box component="span" sx={{ color: ink.mid }}>{t(`${k}.rolledBack`, { version: ver.rolled_back_from })}</Box> : null}
                {ver.is_current ? <Pill tone="ok">{t(`${k}.isCurrent`)}</Pill> : null}
              </Box>
            ))}
            {(versions.data?.versions ?? []).length > 8 ? <Box sx={{ ...typo.caption, color: ink.mid }}>{t(`${k}.more`, { count: (versions.data?.versions ?? []).length - 8 })}</Box> : null}
          </Box>
        ) : (
          <Box sx={{ ...typo.body, color: ink.mid }}>{t(`${k}.noVersions`)}</Box>
        )}
      </Box>
      <Legacy label={t(`${k}.legacy`)} testId="admin-variant-legacy-publish">
        <VersionsTab type={type} readOnly={!canWrite} />
      </Legacy>
    </Box>
  );
}

function ChangeLine({ c }: { c: VariantChange }) {
  const { t, i18n } = useTranslation();
  const k = 'admin.variants.change';
  const l = i18n.language;
  const button = () => (
    <>
      <span data-words="data">{pick(c.zone, l) || t('admin.variants.buttons.noZone')}</span>
      {' · '}
      <span data-words="data">{pick(c.title, l) || t(`admin.variants.kind.${c.kind}`, { defaultValue: t('admin.variants.kind.other') })}</span>
    </>
  );
  switch (c.what) {
    case 'title':
      return (
        <>
          {t(`${k}.title`)} <span data-words="data">{pick(c.from as Record<string, string>, l) || '—'}</span> → <span data-words="data">{pick(c.to as Record<string, string>, l) || '—'}</span>
        </>
      );
    case 'zone_added':
    case 'zone_removed':
      return (
        <>
          {t(`${k}.${c.what}`)} <span data-words="data">{pick(c.zone, l) || t('admin.variants.buttons.noZone')}</span>
        </>
      );
    case 'control_added':
    case 'control_removed':
      return (
        <>
          {t(`${k}.${c.what}`)} {button()}
        </>
      );
    case 'control_changed':
      return (
        <>
          {t(`${k}.control_changed`)} {button()}: {(c.fields ?? []).map((f) => t(`${k}.field.${f}`, { defaultValue: t(`${k}.field.other`) })).join(', ')}
        </>
      );
    case 'plan_level':
      return (
        <>
          {t(`${k}.plan_level`)} {t(`admin.variants.view.${String(c.from) || 'tiles'}`)} → {t(`admin.variants.view.${String(c.to) || 'tiles'}`)}
        </>
      );
    default:
      return <>{t(`${k}.plan`)}</>;
  }
}
