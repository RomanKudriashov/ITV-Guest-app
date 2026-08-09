import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import { ApiError } from '@/api/client';
import {
  copyPlan,
  fetchPlan,
  savePlan,
  uploadPlanFrames,
  type GrmsType,
  type PlanGeometry,
  type PlanPoint,
  type PlanRect,
  type PlanState,
  type PlanWindow,
  type PlanZone,
} from '@/api/grms';
import { queryKeys } from '@/api/queryKeys';
import { useToast } from '@/components/ToastProvider';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { pickTranslated } from '@/utils/translated';
import { storefrontTokens } from '@/guest/storefrontTokens';
import {
  DEFAULT_FEATHER,
  MIN_SIZE,
  clampPercent,
  featherOf,
  maskOf,
  rectFromDrag,
  round1,
  zoneWindowStyle,
} from './planShapes';

/**
 * Редактор плана номера.
 *
 * План — это ДВА совмещённых кадра и разметка в процентах. Кадры приходят сюда
 * двумя путями: администратор приносит один светлый (ночной считает сервер) или
 * свою пару — и тогда она проверяется на совмещение. Разметка рисуется мышью,
 * привязывается к ОПУБЛИКОВАННЫМ элементам выбором из списка и сохраняется в
 * черновик типа: гостю она уезжает публикацией, а не сохранением.
 *
 * Три решения, которые видно в коде.
 *
 * МАСКА НЕ РИСУЕТСЯ РУКАМИ. Администратор обводит комнату; маска — та же
 * комната, расширенная под растушёвку света, и считается из неё (`planShapes`).
 * Два прямоугольника вручную рано или поздно разъедутся, и увидят это в номере.
 *
 * ПРИВЯЗКА — ВЫБОР ИЗ СПИСКА, А НЕ ВВОД `controlId` РУКАМИ. Набранный руками
 * идентификатор живёт до первого переименования элемента, а зона на плане после
 * этого молча перестаёт нажиматься.
 *
 * ЗОНЫ ПРЯМОУГОЛЬНЫЕ. Осознанное ограничение: комнату сложной формы придётся
 * закрыть прямоугольником побольше или разбить на две зоны. Полигоны — это
 * второй редактор (рисование, точки, перетаскивание вершин) и второй формат в
 * снимке; в этот прогон они не входят.
 */

type ShapeKind = 'zone' | 'window' | 'point';
type Tool = 'select' | ShapeKind;
interface Selection {
  kind: ShapeKind;
  index: number;
}

const EMPTY: PlanGeometry = {
  aspect: null,
  zones: [],
  windows: [],
  points: [],
  mirrored: false,
};

/** Пропорция по умолчанию, пока кадра нет: сцена не должна схлопываться в полоску. */
const FALLBACK_ASPECT = 1.6;

/**
 * Сколько ждать посчитанный ночной кадр, прежде чем сказать, что он не
 * посчитался. Ожидание БЕЗ КОНЦА хуже отказа: экран бесконечно обещает то,
 * чего не будет, и перезапрашивает план каждые три секунды до закрытия вкладки.
 */
const BAKE_WAIT_MS = 120_000;

export function PlanEditor({ code, types }: { code: string; types: GrmsType[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);

  // Объявлены ДО запроса: `refetchInterval` спрашивают уже на первом ответе, а
  // объявленные ниже константы к тому моменту ещё не инициализированы.
  const gaveUpRef = useRef(false);
  /** Есть ли несохранённая разметка. См. `refetchInterval` ниже. */
  const dirtyRef = useRef(false);

  const query = useQuery({
    queryKey: queryKeys.grmsPlan(code),
    queryFn: () => fetchPlan(code),
    // Ночной кадр считается фоном. Пока его нет, а светлый уже есть — сами
    // перезапрашиваем: заставлять администратора жать F5 ради фоновой задачи
    // значит переложить на него нашу асинхронность.
    refetchInterval: (q) => {
      const data = q.state.data as PlanState | undefined;
      if (gaveUpRef.current) return false;
      /*
        ПОКА РАЗМЕТКУ ПРАВЯТ — НЕ ОПРАШИВАЕМ.

        Опрос нужен ровно для одного: заметить посчитанный ночной кадр. Ждать
        его можно и до конца правки, а перерисовка каждые три секунды посреди
        обводки зоны — это гонка на ровном месте: ответ приходит между «нажал»
        и «отпустил», компонент перерисовывается, и жест теряется.
      */
      if (dirtyRef.current) return false;
      return data?.frames.lit && !data.frames.off ? 3000 : false;
    },
  });

  const [draft, setDraft] = useState<PlanGeometry>(EMPTY);
  const [baseline, setBaseline] = useState('');
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [feather, setFeather] = useState(DEFAULT_FEATHER);
  const [preview, setPreview] = useState(false);
  const [litZones, setLitZones] = useState<Record<string, boolean>>({});
  const [openWindows, setOpenWindows] = useState<Record<string, boolean>>({});
  const [drag, setDrag] = useState<PlanRect | null>(null);
  const [copySource, setCopySource] = useState('');
  const [litFile, setLitFile] = useState<File | null>(null);
  const [offFile, setOffFile] = useState<File | null>(null);
  const [bakeGaveUp, setBakeGaveUp] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  /*
    Рамка, которую сейчас тянут, живёт И в состоянии, И в ссылке.

    Состояние нужно, чтобы её было видно; ссылка — чтобы её было НЕ ПОТЕРЯТЬ.
    Пока считается ночной кадр, план перезапрашивается каждые три секунды, и
    ответ, пришедший между «нажал» и «отпустил», перерисовывает компонент.
    Обводка в этот момент обрывалась молча: обработчик отпускания читал
    состояние, которого в его замыкании уже не было.
  */
  const dragRef = useRef<PlanRect | null>(null);
  gaveUpRef.current = bakeGaveUp;
  const draftRef = useRef(draft);
  const baselineRef = useRef(baseline);
  draftRef.current = draft;
  baselineRef.current = baseline;

  useEffect(() => {
    if (!query.data) return;
    const geometry = query.data.geometry;
    const incoming = JSON.stringify(geometry);
    if (incoming === baselineRef.current) return;

    // ФОНОВАЯ ПЕРЕЗАГРУЗКА НЕ СТИРАЕТ НЕСОХРАНЁННОЕ. Пока считается ночной
    // кадр, план перезапрашивается каждые три секунды, и безусловная
    // подстановка ответа стирала только что обведённую зону прямо под рукой —
    // ровно в те секунды, когда администратор и начинает размечать.
    const dirty =
      baselineRef.current !== '' && JSON.stringify(draftRef.current) !== baselineRef.current;
    if (dirty) return;

    setDraft(geometry);
    setBaseline(incoming);
    setFeather(featherOf(geometry.zones[0]));
    setSelected(null);
  }, [query.data]);

  // Ключ — идентификаторы кадров, а не весь ответ: иначе таймер сбрасывался бы
  // каждым опросом и не наступал бы никогда.
  const litId = query.data?.frames.lit?.id ?? '';
  const offId = query.data?.frames.off?.id ?? '';
  useEffect(() => {
    if (!litId || offId) {
      setBakeGaveUp(false);
      return;
    }
    const timer = setTimeout(() => setBakeGaveUp(true), BAKE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [litId, offId]);

  const plate = useMemo(() => storefrontTokens('dark').roomPlan, []);
  const isDirty = baseline !== '' && JSON.stringify(draft) !== baseline;
  dirtyRef.current = isDirty;

  const controlsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const control of query.data?.controls ?? []) map.set(control.controlId, control.title);
    return map;
  }, [query.data]);

  const applyPlan = (plan: PlanState) => {
    queryClient.setQueryData(queryKeys.grmsPlan(code), plan);
    setDraft(plan.geometry);
    setBaseline(JSON.stringify(plan.geometry));
  };

  const failure = (error: unknown) =>
    toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');

  const saveMutation = useMutation({
    mutationFn: () => savePlan(code, draft),
    onSuccess: (plan) => {
      applyPlan(plan);
      toast.show(t('roomControl.plan.saved'), 'success');
    },
    onError: failure,
  });

  const uploadMutation = useMutation({
    mutationFn: () => uploadPlanFrames(code, litFile as File, offFile),
    onSuccess: (result) => {
      if (!result.ok) {
        // Не совпало — НИЧЕГО не сохранено. Половина пары в конфигурации хуже,
        // чем её отсутствие, и молчать об этом нельзя.
        toast.show(t(`roomControl.plan.pair.${result.pair?.reason || 'not_aligned'}`), 'error');
        return;
      }
      setLitFile(null);
      setOffFile(null);
      if (result.plan) applyPlan(result.plan);
      void queryClient.invalidateQueries({ queryKey: queryKeys.grmsPlan(code) });
      toast.show(
        result.night === 'baking' ? t('roomControl.plan.baking') : t('roomControl.plan.framesSaved'),
        'success',
      );
    },
    onError: failure,
  });

  const copyMutation = useMutation({
    mutationFn: () => copyPlan(code, copySource),
    onSuccess: (plan) => {
      applyPlan(plan);
      toast.show(t('roomControl.plan.copied'), 'success');
    },
    onError: failure,
  });

  /* ── Рисование ───────────────────────────────────────────────────────── */

  const percentAt = (clientX: number, clientY: number) => {
    const box = stageRef.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return { x: 0, y: 0 };
    return {
      x: clampPercent(((clientX - box.left) / box.width) * 100),
      y: clampPercent(((clientY - box.top) / box.height) * 100),
    };
  };

  /** Свободный код фигуры. Номер по количеству дал бы дубль после удаления, а
   * одинаковые коды — это одинаковые ключи предпросмотра и общий свет у двух
   * разных комнат. */
  const freeCode = (prefix: string, taken: string[]) => {
    let index = taken.length + 1;
    while (taken.includes(`${prefix}-${index}`)) index += 1;
    return `${prefix}-${index}`;
  };

  const addShape = (rect: PlanRect) => {
    if (tool === 'zone') {
      const zone: PlanZone = {
        code: freeCode('zone', draft.zones.map((z) => z.code)),
        controlId: '',
        hit: rect,
        mask: maskOf(rect, feather),
      };
      setDraft((prev) => ({ ...prev, zones: [...prev.zones, zone] }));
      setSelected({ kind: 'zone', index: draft.zones.length });
    } else if (tool === 'window') {
      const frame: PlanWindow = {
        ...rect,
        code: freeCode('win', draft.windows.map((w) => w.code)),
        // Ориентация — не украшение: по ней свет из окна разливается вдоль
        // рамы, а не поперёк. Угадываем по форме, править можно рядом.
        orientation: rect.w >= rect.h ? 'horizontal' : 'vertical',
        curtainId: '',
        blackoutId: '',
      };
      setDraft((prev) => ({ ...prev, windows: [...prev.windows, frame] }));
      setSelected({ kind: 'window', index: draft.windows.length });
    }
    setTool('select');
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (preview || tool === 'select') return;
    const point = percentAt(event.clientX, event.clientY);
    if (tool === 'point') {
      const created: PlanPoint = { controlId: '', x: point.x, y: point.y };
      setDraft((prev) => ({ ...prev, points: [...prev.points, created] }));
      setSelected({ kind: 'point', index: draft.points.length });
      setTool('select');
      return;
    }
    dragStart.current = point;
    dragRef.current = { x: point.x, y: point.y, w: 0, h: 0 };
    setDrag(dragRef.current);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const point = percentAt(event.clientX, event.clientY);
    dragRef.current = rectFromDrag(dragStart.current.x, dragStart.current.y, point.x, point.y);
    setDrag(dragRef.current);
  };

  const onPointerUp = () => {
    const rect = dragRef.current;
    dragStart.current = null;
    dragRef.current = null;
    setDrag(null);
    if (rect && rect.w >= MIN_SIZE && rect.h >= MIN_SIZE) addShape(rect);
  };

  /* ── Правка выбранной фигуры ─────────────────────────────────────────── */

  const patchZone = (index: number, patch: Partial<PlanZone>) =>
    setDraft((prev) => ({
      ...prev,
      zones: prev.zones.map((zone, i) => {
        if (i !== index) return zone;
        const next = { ...zone, ...patch };
        // Маска всегда следует за зоной: рассинхронизировать их нельзя даже
        // намеренно — гость увидел бы свет не там, куда нажимал.
        return { ...next, mask: maskOf(next.hit, feather) };
      }),
    }));

  const patchWindow = (index: number, patch: Partial<PlanWindow>) =>
    setDraft((prev) => ({
      ...prev,
      windows: prev.windows.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    }));

  const patchPoint = (index: number, patch: Partial<PlanPoint>) =>
    setDraft((prev) => ({
      ...prev,
      points: prev.points.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));

  const removeSelected = () => {
    if (!selected) return;
    const { kind, index } = selected;
    setDraft((prev) => ({
      ...prev,
      zones: kind === 'zone' ? prev.zones.filter((_, i) => i !== index) : prev.zones,
      windows: kind === 'window' ? prev.windows.filter((_, i) => i !== index) : prev.windows,
      points: kind === 'point' ? prev.points.filter((_, i) => i !== index) : prev.points,
    }));
    setSelected(null);
  };

  // Растушёвка меняется разом для всех зон: это свойство света на кадре, а не
  // отдельной комнаты.
  const applyFeather = (value: number) => {
    setFeather(value);
    setDraft((prev) => ({
      ...prev,
      zones: prev.zones.map((zone) => ({ ...zone, mask: maskOf(zone.hit, value) })),
    }));
  };

  if (query.isLoading) return <Skeleton variant="rounded" height={420} />;
  if (query.isError || !query.data) {
    return <Alert severity="error">{t('roomControl.plan.loadError')}</Alert>;
  }

  const plan = query.data;
  const aspect = draft.aspect || plan.geometry.aspect || FALLBACK_ASPECT;
  // Инструмент рисования выбран — уже расставленные фигуры перестают ловить
  // указатель: иначе обвести комнату поверх соседней зоны нельзя, а зоны в
  // номере соседствуют всегда.
  const drawing = tool !== 'select' && !preview;
  const litUrl = plan.frames.lit?.url || '';
  const offUrl = plan.frames.off?.url || '';
  const baseUrl = preview && offUrl ? offUrl : litUrl;

  const zoneLit = (zone: PlanZone) => Boolean(litZones[zone.code || zone.controlId]);

  return (
    <Stack spacing={2} data-testid="grms-plan-editor">
      {/* ── Кадры ─────────────────────────────────────────────────────── */}
      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent>
          <Typography variant="subtitle1">{t('roomControl.plan.frames')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('roomControl.plan.framesHint')}
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
            <Button component="label" variant="outlined" data-testid="grms-plan-pick-lit">
              {litFile ? litFile.name : t('roomControl.plan.pickLit')}
              <input
                hidden
                type="file"
                accept="image/*"
                data-testid="grms-plan-lit-input"
                onChange={(e) => setLitFile(e.target.files?.[0] ?? null)}
              />
            </Button>
            <Button component="label" variant="text" data-testid="grms-plan-pick-off">
              {offFile ? offFile.name : t('roomControl.plan.pickOff')}
              <input
                hidden
                type="file"
                accept="image/*"
                data-testid="grms-plan-off-input"
                onChange={(e) => setOffFile(e.target.files?.[0] ?? null)}
              />
            </Button>
            <Button
              variant="contained"
              disabled={!litFile || uploadMutation.isPending}
              onClick={() => uploadMutation.mutate()}
              data-testid="grms-plan-upload"
            >
              {t('roomControl.plan.upload')}
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Chip
              size="small"
              data-testid="grms-plan-night-state"
              color={offUrl ? 'success' : 'default'}
              label={
                offUrl
                  ? t(`roomControl.plan.night.${plan.frames.off_source || 'baked'}`)
                  : litUrl
                    ? t(`roomControl.plan.night.${bakeGaveUp ? 'failed' : 'baking'}`)
                    : t('roomControl.plan.night.none')
              }
            />
          </Stack>
          {uploadMutation.data && !uploadMutation.data.ok && (
            <Alert severity="error" sx={{ mt: 2 }} data-testid="grms-plan-pair-error">
              <AlertTitle>
                {t(`roomControl.plan.pair.${uploadMutation.data.pair?.reason || 'not_aligned'}`)}
              </AlertTitle>
              {t('roomControl.plan.pairHint')}
            </Alert>
          )}
        </CardContent>
      </Card>

      {!plan.published && (
        <Alert severity="warning" data-testid="grms-plan-unpublished">
          {t('roomControl.plan.needPublish')}
        </Alert>
      )}

      <Stack direction="row" spacing={2} alignItems="flex-start" flexWrap="wrap" useFlexGap>
        {/* ── Сцена ───────────────────────────────────────────────────── */}
        <Card variant="outlined" sx={{ flexGrow: 1, minWidth: 380, borderColor: 'divider' }}>
          <CardContent>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
              sx={{ mb: 1.5 }}
            >
              <ToggleButtonGroup
                size="small"
                exclusive
                value={tool}
                onChange={(_, value: Tool | null) => value && setTool(value)}
                disabled={preview}
              >
                <ToggleButton value="select" data-testid="grms-plan-tool-select">
                  {t('roomControl.plan.tool.select')}
                </ToggleButton>
                <ToggleButton value="zone" data-testid="grms-plan-tool-zone">
                  {t('roomControl.plan.tool.zone')}
                </ToggleButton>
                <ToggleButton value="window" data-testid="grms-plan-tool-window">
                  {t('roomControl.plan.tool.window')}
                </ToggleButton>
                <ToggleButton value="point" data-testid="grms-plan-tool-point">
                  {t('roomControl.plan.tool.point')}
                </ToggleButton>
              </ToggleButtonGroup>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={preview}
                    onChange={(e) => setPreview(e.target.checked)}
                    data-testid="grms-plan-preview"
                  />
                }
                label={t('roomControl.plan.preview')}
              />
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={draft.mirrored}
                    onChange={(e) => setDraft((prev) => ({ ...prev, mirrored: e.target.checked }))}
                    data-testid="grms-plan-mirror"
                  />
                }
                label={t('roomControl.plan.mirrored')}
              />
            </Stack>

            {litUrl ? (
              <Box
                ref={stageRef}
                data-testid="grms-plan-stage"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                sx={{
                  position: 'relative',
                  width: '100%',
                  aspectRatio: String(aspect),
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: 1,
                  borderColor: 'divider',
                  cursor: tool === 'select' || preview ? 'default' : 'crosshair',
                  touchAction: 'none',
                  userSelect: 'none',
                  // Зеркальность — свойство комнаты: отражается плита целиком,
                  // ровно как у гостя, иначе разметку правили бы по одной
                  // картинке, а гость смотрел бы на другую.
                  transform: draft.mirrored ? 'scaleX(-1)' : undefined,
                }}
              >
                {/*
                  `draggable={false}` и `pointerEvents: 'none'` — не украшение.
                  Браузер считает протаскивание по картинке НАЧАЛОМ ПЕРЕНОСА
                  файла, отменяет указатель (`pointercancel`) — и обводка зоны
                  обрывается на первом же миллиметре. Кадр здесь фон, а не
                  объект, который куда-то тащат.
                */}
                <Box
                  component="img"
                  src={baseUrl}
                  alt=""
                  draggable={false}
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                  }}
                />

                {/* Светлый кадр окнами по включённым зонам — то же, что видит гость. */}
                {preview &&
                  offUrl &&
                  draft.zones.filter(zoneLit).map((zone) => (
                    <Box
                      key={`lit-${zone.code}`}
                      component="img"
                      src={litUrl}
                      alt=""
                      draggable={false}
                      style={zoneWindowStyle(
                        zone.hit,
                        zone.mask,
                        plate.zoneWindowInk,
                        plate.zoneWindowEdge,
                      )}
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        pointerEvents: 'none',
                      }}
                    />
                  ))}

                {draft.zones.map((zone, index) => {
                  const active = selected?.kind === 'zone' && selected.index === index;
                  return (
                    <Box
                      key={`zone-${index}`}
                      component="button"
                      type="button"
                      data-testid={`grms-plan-zone-${index}`}
                      data-lit={preview ? String(zoneLit(zone)) : undefined}
                      onClick={() => {
                        if (preview) {
                          const key = zone.code || zone.controlId;
                          setLitZones((prev) => ({ ...prev, [key]: !prev[key] }));
                        } else {
                          setSelected({ kind: 'zone', index });
                        }
                      }}
                      style={{
                        left: `${zone.hit.x}%`,
                        top: `${zone.hit.y}%`,
                        width: `${zone.hit.w}%`,
                        height: `${zone.hit.h}%`,
                      }}
                      sx={{
                        position: 'absolute',
                        p: 0,
                        border: 2,
                        borderStyle: zone.controlId ? 'solid' : 'dashed',
                        borderColor: active ? 'primary.main' : 'primary.light',
                        borderRadius: 1,
                        bgcolor: (theme) =>
                          alpha(theme.palette.primary.main, active ? 0.24 : preview ? 0 : 0.1),
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'flex-start',
                        overflow: 'hidden',
                        pointerEvents: drawing ? 'none' : undefined,
                      }}
                    >
                      {!preview && (
                        <Typography
                          variant="caption"
                          sx={{
                            px: 0.5,
                            bgcolor: 'background.paper',
                            borderBottomRightRadius: 4,
                            maxWidth: '100%',
                          }}
                          noWrap
                        >
                          {controlsById.get(zone.controlId) ||
                            zone.code ||
                            t('roomControl.plan.unbound')}
                        </Typography>
                      )}
                    </Box>
                  );
                })}

                {draft.windows.map((frame, index) => {
                  const active = selected?.kind === 'window' && selected.index === index;
                  const closed = !openWindows[frame.code || String(index)];
                  return (
                    <Box
                      key={`window-${index}`}
                      component="button"
                      type="button"
                      data-testid={`grms-plan-window-${index}`}
                      data-open={preview ? String(!closed) : undefined}
                      onClick={() => {
                        if (preview) {
                          const key = frame.code || String(index);
                          setOpenWindows((prev) => ({ ...prev, [key]: !prev[key] }));
                        } else {
                          setSelected({ kind: 'window', index });
                        }
                      }}
                      style={{
                        left: `${frame.x}%`,
                        top: `${frame.y}%`,
                        width: `${frame.w}%`,
                        height: `${frame.h}%`,
                      }}
                      sx={{
                        position: 'absolute',
                        p: 0,
                        border: 2,
                        borderStyle: frame.curtainId ? 'solid' : 'dashed',
                        borderColor: active ? 'secondary.main' : 'secondary.light',
                        bgcolor: (theme) =>
                          alpha(
                            theme.palette.secondary.main,
                            preview ? (closed ? 0.55 : 0) : active ? 0.3 : 0.15,
                          ),
                        cursor: 'pointer',
                        pointerEvents: drawing ? 'none' : undefined,
                      }}
                    />
                  );
                })}

                {draft.points.map((point, index) => {
                  const active = selected?.kind === 'point' && selected.index === index;
                  return (
                    <Box
                      key={`point-${index}`}
                      component="button"
                      type="button"
                      data-testid={`grms-plan-point-${index}`}
                      onClick={() => !preview && setSelected({ kind: 'point', index })}
                      style={{ left: `${point.x}%`, top: `${point.y}%` }}
                      sx={{
                        position: 'absolute',
                        width: 18,
                        height: 18,
                        ml: '-9px',
                        mt: '-9px',
                        p: 0,
                        borderRadius: '50%',
                        border: 2,
                        borderColor: active ? 'info.main' : 'info.light',
                        bgcolor: (theme) => alpha(theme.palette.info.main, 0.5),
                        cursor: 'pointer',
                        pointerEvents: drawing ? 'none' : undefined,
                      }}
                    />
                  );
                })}

                {drag && (
                  <Box
                    style={{
                      left: `${drag.x}%`,
                      top: `${drag.y}%`,
                      width: `${drag.w}%`,
                      height: `${drag.h}%`,
                    }}
                    sx={{
                      position: 'absolute',
                      border: 2,
                      borderStyle: 'dashed',
                      borderColor: 'primary.main',
                      bgcolor: (theme) => alpha(theme.palette.primary.main, 0.16),
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </Box>
            ) : (
              <Alert severity="info" data-testid="grms-plan-no-frame">
                {t('roomControl.plan.noFrame')}
              </Alert>
            )}

            {preview && !offUrl && litUrl && (
              <Alert severity="info" sx={{ mt: 1.5 }}>
                {t('roomControl.plan.previewNeedsNight')}
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* ── Инспектор ───────────────────────────────────────────────── */}
        <Card variant="outlined" sx={{ width: 360, flexShrink: 0, borderColor: 'divider' }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              {t('roomControl.plan.inspector')}
            </Typography>

            {!selected && (
              <Typography variant="body2" color="text.secondary">
                {t('roomControl.plan.inspectorHint')}
              </Typography>
            )}

            {selected?.kind === 'zone' && draft.zones[selected.index] && (
              <Stack spacing={1.5} data-testid="grms-plan-form-zone">
                <TextField
                  size="small"
                  label={t('roomControl.plan.zoneCode')}
                  value={draft.zones[selected.index].code}
                  onChange={(e) => patchZone(selected.index, { code: e.target.value })}
                />
                <TextField
                  select
                  size="small"
                  label={t('roomControl.plan.control')}
                  value={draft.zones[selected.index].controlId}
                  onChange={(e) => patchZone(selected.index, { controlId: e.target.value })}
                  data-testid="grms-plan-form-control"
                  helperText={t('roomControl.plan.controlHint')}
                >
                  <MenuItem value="">{t('roomControl.plan.unbound')}</MenuItem>
                  {plan.controls.map((control) => (
                    <MenuItem key={control.controlId} value={control.controlId}>
                      {control.title}
                    </MenuItem>
                  ))}
                </TextField>
                <RectFields
                  rect={draft.zones[selected.index].hit}
                  onChange={(hit) => patchZone(selected.index, { hit })}
                />
              </Stack>
            )}

            {selected?.kind === 'window' && draft.windows[selected.index] && (
              <Stack spacing={1.5} data-testid="grms-plan-form-window">
                <TextField
                  size="small"
                  label={t('roomControl.plan.windowCode')}
                  value={draft.windows[selected.index].code}
                  onChange={(e) => patchWindow(selected.index, { code: e.target.value })}
                />
                <TextField
                  select
                  size="small"
                  label={t('roomControl.plan.orientation')}
                  value={draft.windows[selected.index].orientation}
                  onChange={(e) =>
                    patchWindow(selected.index, {
                      orientation: e.target.value as PlanWindow['orientation'],
                    })
                  }
                >
                  <MenuItem value="horizontal">{t('roomControl.plan.horizontal')}</MenuItem>
                  <MenuItem value="vertical">{t('roomControl.plan.vertical')}</MenuItem>
                </TextField>
                <TextField
                  select
                  size="small"
                  label={t('roomControl.plan.curtain')}
                  value={draft.windows[selected.index].curtainId}
                  onChange={(e) => patchWindow(selected.index, { curtainId: e.target.value })}
                  data-testid="grms-plan-form-curtain"
                >
                  <MenuItem value="">{t('roomControl.plan.unbound')}</MenuItem>
                  {plan.controls.map((control) => (
                    <MenuItem key={control.controlId} value={control.controlId}>
                      {control.title}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label={t('roomControl.plan.blackout')}
                  value={draft.windows[selected.index].blackoutId}
                  onChange={(e) => patchWindow(selected.index, { blackoutId: e.target.value })}
                >
                  <MenuItem value="">{t('roomControl.plan.noBlackout')}</MenuItem>
                  {plan.controls.map((control) => (
                    <MenuItem key={control.controlId} value={control.controlId}>
                      {control.title}
                    </MenuItem>
                  ))}
                </TextField>
                <RectFields
                  rect={draft.windows[selected.index]}
                  onChange={(rect) => patchWindow(selected.index, rect)}
                />
              </Stack>
            )}

            {selected?.kind === 'point' && draft.points[selected.index] && (
              <Stack spacing={1.5} data-testid="grms-plan-form-point">
                <TextField
                  select
                  size="small"
                  label={t('roomControl.plan.airPoint')}
                  value={draft.points[selected.index].controlId}
                  onChange={(e) => patchPoint(selected.index, { controlId: e.target.value })}
                  data-testid="grms-plan-form-air"
                >
                  <MenuItem value="">{t('roomControl.plan.unbound')}</MenuItem>
                  {plan.controls.map((control) => (
                    <MenuItem key={control.controlId} value={control.controlId}>
                      {control.title}
                    </MenuItem>
                  ))}
                </TextField>
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small"
                    type="number"
                    label="X %"
                    value={draft.points[selected.index].x}
                    onChange={(e) =>
                      patchPoint(selected.index, { x: round1(Number(e.target.value)) })
                    }
                  />
                  <TextField
                    size="small"
                    type="number"
                    label="Y %"
                    value={draft.points[selected.index].y}
                    onChange={(e) =>
                      patchPoint(selected.index, { y: round1(Number(e.target.value)) })
                    }
                  />
                </Stack>
              </Stack>
            )}

            {selected && (
              <Button
                size="small"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                onClick={removeSelected}
                sx={{ mt: 2 }}
                data-testid="grms-plan-delete"
              >
                {t('common.delete')}
              </Button>
            )}

            <Divider sx={{ my: 2 }} />

            <TextField
              size="small"
              type="number"
              fullWidth
              label={t('roomControl.plan.feather')}
              value={feather}
              onChange={(e) => applyFeather(round1(Number(e.target.value)))}
              helperText={t('roomControl.plan.featherHint')}
            />

            <Divider sx={{ my: 2 }} />

            <Typography variant="caption" color="text.secondary">
              {t('roomControl.plan.copyHint')}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <TextField
                select
                size="small"
                fullWidth
                label={t('roomControl.plan.copyFrom')}
                value={copySource}
                onChange={(e) => setCopySource(e.target.value)}
                data-testid="grms-plan-copy-source"
              >
                {types
                  .filter((type) => type.code !== code)
                  .map((type) => (
                    <MenuItem key={type.code} value={type.code}>
                      {pickTranslated(
                        type.title,
                        languages.displayLanguage,
                        languages.defaultCode,
                      ) || type.code}
                    </MenuItem>
                  ))}
              </TextField>
              <Button
                variant="outlined"
                disabled={!copySource || copyMutation.isPending}
                onClick={() => copyMutation.mutate()}
                data-testid="grms-plan-copy"
              >
                {t('roomControl.plan.copy')}
              </Button>
            </Stack>

            <Divider sx={{ my: 2 }} />

            <Alert severity="info" sx={{ mb: 2 }}>
              {t('roomControl.plan.rectOnly')}
            </Alert>

            <Button
              fullWidth
              variant="contained"
              disabled={!isDirty || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              data-testid="grms-plan-save"
            >
              {t('common.save')}
            </Button>
          </CardContent>
        </Card>
      </Stack>
    </Stack>
  );
}

/** Четыре числа прямоугольника. В процентах — других единиц у разметки нет. */
function RectFields({
  rect,
  onChange,
}: {
  rect: PlanRect;
  onChange: (rect: PlanRect) => void;
}) {
  const field = (key: keyof PlanRect, label: string) => (
    <TextField
      size="small"
      type="number"
      label={label}
      value={rect[key]}
      onChange={(e) => onChange({ ...rect, [key]: round1(Number(e.target.value)) })}
      inputProps={{ step: 0.5 }}
    />
  );
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1}>
        {field('x', 'X %')}
        {field('y', 'Y %')}
      </Stack>
      <Stack direction="row" spacing={1}>
        {field('w', 'W %')}
        {field('h', 'H %')}
      </Stack>
    </Stack>
  );
}
