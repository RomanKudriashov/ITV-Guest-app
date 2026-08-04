import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { ApiError } from '@/api/client';

import { KitEmptyState, KitToast, SkeletonCard, SkeletonLine } from '@/kit';
import {
  IconAirConditioner,
  IconBlackout,
  IconCurtain,
  IconDoNotDisturb,
  IconLightGroup,
  IconMakeUpRoom,
  IconOffline,
  IconPower,
  IconRoom,
  IconScene,
  IconSwitch,
} from '@/icons';
import { RoomPlanPlate, type PlanReading } from '../components/RoomPlanPlate';
import {
  ControlRow,
  CurtainArrows,
  OutlineWideButton,
  RoomDial,
  RoomTabs,
  RowSwitch,
  SceneTile,
  Segmented,
  StatusPill,
  useSwipe,
} from '../components/roomKit';
import { errorMessage } from '../errors';
import { useRoomCommand, useRoomLive, useRoomState, useRoomVerify } from '../hooks/useRoomControl';
import { DESKTOP_QUERY } from '../layout/constants';
import { useGuestSession } from '../session/GuestSessionProvider';
import { layout, stickyUnderFloating } from '../storefrontTokens';
import { useStorefront } from '../useStorefront';
import type {
  RoomCapability,
  RoomControl,
  RoomStateSnapshot,
  RoomZone,
} from '../api/types';

/**
 * Экран управления номером.
 *
 * Три правила, из которых следует почти вся механика.
 *
 * 1. ВЕТВЛЕНИЕ ПО CAPABILITY, никогда по `controlId`. `kind` решает ровно два
 *    вопроса ПОКАЗА — какая иконка и в какую панель попал элемент; ни одного
 *    решения о поведении по нему не принимается. Причина в ТЗ §1: GRMS другого
 *    производителя обязан подключиться без правки гостевого интерфейса.
 *
 * 2. ОПТИМИСТИЧНЫХ ПЕРЕКЛЮЧЕНИЙ НЕТ. Состояние меняется только после
 *    подтверждения. Пока команда в полёте, элемент показывает ПОСЛЕДНЕЕ
 *    ПОДТВЕРЖДЁННОЕ значение с признаком обмена — не желаемое и не
 *    выключенное. Сервер в полёте значений не отдаёт (он их не перечитывал),
 *    поэтому помнит клиент, и помнит ровно до `offline`: там состояния нет.
 *
 * 3. КОМПОЗИЦИЯ ИЗ МАКЕТА (docs/design/grms-concept/room-control-mockup.html):
 *    ряд пилюль, плита плана, управление СТРОКАМИ, сгруппированное ПО ТИПУ —
 *    свет, климат, шторы, сцены, сервис. Группировка по комнатам, которая была
 *    здесь раньше, разносила климат в «Спальню», а сцены смешивала с сервисом
 *    в «Весь номер»: гость искал вентилятор в комнате, а не в климате.
 */
export function RoomPage() {
  const { t } = useTranslation();
  const { glass } = useStorefront();
  const { session, hotel } = useGuestSession();
  const enabled = Boolean(hotel?.room_control_enabled ?? session?.hotel.room_control_enabled);

  const state = useRoomState(enabled);
  const live = useRoomLive(enabled);
  const command = useRoomCommand();
  const [notice, setNotice] = useState<{ severity: 'success' | 'warning' | 'error'; text: string } | null>(
    null,
  );

  const snapshot = state.data;

  // Исход команды показывается ОДИН раз и по факту, а не по надежде: снимок
  // приезжает и на подтверждении, и на возврате в исходное, и без этой
  // подписи гость не отличил бы одно от другого.
  const outcome = live.lastCommand;
  const clearOutcome = live.clearLastCommand;
  useEffect(() => {
    if (!outcome) return;
    if (outcome.result === 'confirmed' || outcome.result === 'accepted') {
      setNotice(null);
    } else if (outcome.result === 'unconfirmed') {
      setNotice({ severity: 'warning', text: t('guest.roomControl.unconfirmed') });
    } else if (outcome.result === 'failed') {
      setNotice({ severity: 'error', text: t('guest.roomControl.failed') });
    }
    clearOutcome();
  }, [outcome, clearOutcome, t]);

  const send = (input: { controlId: string; capability?: string; value?: number | null }) => {
    setNotice(null);
    command.mutate(input, {
      onError: (error) => setNotice({ severity: 'error', text: errorMessage(error, t) }),
    });
  };

  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const readings = useRoomReadings(snapshot);
  const groups = useMemo(() => groupControls(snapshot?.zones ?? []), [snapshot]);
  const planWidth = usePlanShrink(Boolean(snapshot?.plan) && !isDesktop);
  const { ref: plateRef, height: plateHeight } = useMeasuredHeight();

  const tabs = useMemo(
    () =>
      (Object.keys(groups) as GroupKey[])
        .filter((key) => groups[key].length > 0)
        .map((key) => ({ value: key, label: t(`guest.roomControl.tab.${key}`) })),
    [groups, t],
  );
  const [tab, setTab] = useState<GroupKey>('light');
  useEffect(() => {
    // Выбранная вкладка могла исчезнуть вместе с оборудованием — тогда
    // показываем первую существующую, а не пустоту.
    if (tabs.length && !tabs.some((item) => item.value === tab)) setTab(tabs[0].value as GroupKey);
  }, [tabs, tab]);

  const swipe = useSwipe((direction) => {
    const index = tabs.findIndex((item) => item.value === tab);
    const next = tabs[Math.max(0, Math.min(tabs.length - 1, index + direction))];
    if (next) setTab(next.value as GroupKey);
  });

  if (!enabled) {
    // Сюда обычно не попасть — пункта навигации нет, — но прямой заход по
    // адресу возможен, и он обязан упереться в тот же ответ, что и сервер.
    return (
      <Box sx={{ pb: 4 }} data-testid="room-page">
        <KitEmptyState
          icon={<IconOffline size={28} />}
          title={t('guest.roomControl.unavailable')}
          testId="room-unavailable"
        />
      </Box>
    );
  }

  const unavailable = snapshot?.availability === 'unavailable';
  const plate = snapshot?.plan ? (
    <RoomPlanPlate
      plan={snapshot.plan}
      readings={planReadings(readings)}
      // Состояния не читаются — плита нейтральна: она не показывает свет ни
      // включённым, ни выключенным, потому что и то и другое было бы враньём.
      neutral={unavailable}
      widthPercent={isDesktop ? 100 : planWidth}
      // Тап по комнате идёт ТЕМ ЖЕ путём, что и тумблер в списке: один
      // обработчик, одна проверка доверия, один дедуп в полёте на сервере.
      onToggle={(controlId, value) => send({ controlId, capability: 'toggle', value })}
    />
  ) : null;

  const panels = (
    <Panels
      groups={groups}
      readings={readings}
      only={isDesktop ? null : tab}
      canCommand={Boolean(snapshot?.can_command)}
      onCommand={send}
    />
  );

  const body = unavailable ? (
    <KitEmptyState
      icon={<IconOffline size={28} />}
      title={snapshot?.message ?? t('guest.roomControl.unavailable')}
      testId="room-unavailable"
    />
  ) : !snapshot || snapshot.zones.every((zone) => zone.controls.length === 0) ? (
    <KitEmptyState
      icon={<IconRoom size={28} />}
      title={t('guest.roomControl.empty')}
      description={t('guest.roomControl.emptyHint')}
      testId="room-empty"
    />
  ) : (
    panels
  );

  const notices = (
    <Stack spacing={1.5}>
      {snapshot && !snapshot.can_command ? <PinPanel /> : null}
      {live.status === 'offline' ? (
        <KitToast severity="info" message={t('guest.roomControl.liveOffline')} testId="room-live-offline" />
      ) : null}
      {notice ? (
        <KitToast
          severity={notice.severity}
          message={notice.text}
          action={
            <Button size="small" onClick={() => setNotice(null)}>
              {t('guest.common.close')}
            </Button>
          }
          testId="room-notice"
        />
      ) : null}
      {!snapshot && state.isError ? (
        <KitToast severity="error" message={errorMessage(state.error, t)} testId="room-error" />
      ) : null}
    </Stack>
  );

  return (
    <Box
      sx={{
        pb: 6,
        px: 2,
        // Сверху — ровно столько, чтобы пилюли прошли ПОД плавающей группой
        // контролов, а не под ней. Число из словаря: группа и содержимое уже
        // однажды столкнулись в одной полосе.
        pt: isDesktop ? 2 : `${stickyUnderFloating}px`,
      }}
      data-testid="room-page"
    >
      <Pills snapshot={snapshot} groups={groups} readings={readings} />

      {state.isPending ? <RoomSkeleton /> : null}

      {isDesktop ? (
        /* Десктоп: две колонки как в макете — план слева и залипает, панели
           стопкой справа. Вкладок нет: на широком экране прятать половину
           управления за переключателем незачем. */
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1.25fr 0.95fr',
            alignItems: 'start',
            gap: 2,
            mt: 2,
          }}
          data-testid="room-two-columns"
        >
          <Box sx={{ position: 'sticky', top: `${stickyUnderFloating}px` }}>
            <PlateWithTag plate={plate} groups={groups} readings={readings} />
          </Box>
          <Stack spacing={2} sx={{ minWidth: 0 }}>
            {notices}
            {body}
          </Stack>
        </Box>
      ) : (
        <>
          {plate ? (
            <Box
              ref={plateRef}
              sx={{
                position: 'sticky',
                top: `${stickyUnderFloating}px`,
                zIndex: 2,
                mt: 1.5,
                width: '100%',
                maxWidth: `${layout.planMaxNarrow}px`,
                mx: 'auto',
              }}
            >
              <PlateWithTag plate={plate} groups={groups} readings={readings} />
            </Box>
          ) : null}

          <Stack spacing={2} sx={{ mt: 2 }}>
            {notices}
          </Stack>

          {tabs.length > 1 && !unavailable ? (
            <Box
              sx={{
                position: 'sticky',
                // Вкладки пинятся ПОД плитой: её высота меняется при сжатии,
                // поэтому она измеряется, а не вписывается числом.
                top: `${stickyUnderFloating + plateHeight}px`,
                zIndex: 1,
                pt: 1,
                mb: `${layout.panelOverlap}px`,
                ...glass.bar,
              }}
            >
              <RoomTabs
                items={tabs}
                active={tab}
                onChange={(value) => setTab(value as GroupKey)}
              />
            </Box>
          ) : null}

          <Box {...swipe} sx={{ mt: 2 }}>
            {body}
          </Box>
        </>
      )}
    </Box>
  );
}

/* ── Плита и плашка состояния шторы ───────────────────────────────────────── */

/**
 * Поверх плиты — стеклянная пилюля состояния шторы, как в макете. Она стоит
 * именно на плите, а не в списке: штора видна на плане, и подпись рядом с ней
 * отвечает на вопрос «что это там на окнах» без перевода взгляда.
 */
function PlateWithTag({
  plate,
  groups,
  readings,
}: {
  plate: ReactNode;
  groups: Groups;
  readings: Readings;
  }) {
  const { t } = useTranslation();
  const { glass, roomControl } = useStorefront();
  if (!plate) return null;

  const curtain = groups.curtain[0];
  const reading = curtain ? readings[curtain.controlId] : undefined;
  const on = reading ? readingOn(reading) : null;

  return (
    <Box sx={{ position: 'relative' }}>
      {plate}
      {on !== null ? (
        <Stack
          direction="row"
          alignItems="center"
          spacing={0.75}
          data-testid="room-curtain-tag"
          sx={(theme) => ({
            position: 'absolute',
            insetInlineEnd: '3%',
            top: '4%',
            px: 1.25,
            py: 0.75,
            borderRadius: `${theme.palette.brand.radius.pill}px`,
            fontSize: 11,
            fontWeight: 700,
            color: on ? roomControl.accent : 'text.secondary',
            ...glass.chip,
          })}
        >
          <IconCurtain size={13} />
          <span>{on ? t('guest.roomControl.curtainOpen') : t('guest.roomControl.curtainClosed')}</span>
        </Stack>
      ) : null}
    </Box>
  );
}

/* ── Пилюли статуса ───────────────────────────────────────────────────────── */

function Pills({
  snapshot,
  groups,
  readings,
}: {
  snapshot: RoomStateSnapshot | undefined;
  groups: Groups;
  readings: Readings;
}) {
  const { t } = useTranslation();
  if (!snapshot || snapshot.availability === 'unavailable') return null;

  const climate = groups.climate[0];
  const temperature = climate ? readings[climate.controlId]?.values.current_temp : undefined;
  const lit = groups.light.filter((control) => readingOn(readings[control.controlId]) === true).length;
  const known = groups.light.filter((control) => readingOn(readings[control.controlId]) !== null).length;

  const curtain = groups.curtain[0];
  const curtainOn = curtain ? readingOn(readings[curtain.controlId]) : null;
  const service = groups.service.find((control) => control.kind === 'dnd');
  const dnd = service ? readingOn(readings[service.controlId]) : null;

  const pills: ReactNode[] = [];
  // Пилюля рисуется, ТОЛЬКО если её значение прочитано. «—» вместо градусов
  // это не честность, а просто другой способ ничего не сказать.
  if (typeof temperature === 'number') {
    pills.push(
      <StatusPill key="temp" tone="cold" testId="room-pill-temp">
        {t('guest.roomControl.pillTemp', { value: temperature })}
      </StatusPill>,
    );
  }
  if (known > 0) {
    pills.push(
      <StatusPill key="lit" tone={lit > 0 ? 'warm' : 'neutral'} testId="room-pill-lit">
        {t('guest.roomControl.pillZones', { count: lit })}
      </StatusPill>,
    );
  }
  if (curtainOn !== null) {
    pills.push(
      <StatusPill key="curtain" tone={curtainOn ? 'ok' : 'neutral'} testId="room-pill-curtain">
        {curtainOn ? t('guest.roomControl.curtainOpen') : t('guest.roomControl.curtainClosed')}
      </StatusPill>,
    );
  }
  if (dnd !== null) {
    pills.push(
      <StatusPill key="dnd" tone={dnd ? 'ok' : 'neutral'} testId="room-pill-dnd">
        {dnd ? t('guest.roomControl.pillDndOn') : t('guest.roomControl.pillDndOff')}
      </StatusPill>,
    );
  }
  if (!pills.length) return null;

  return (
    <Stack
      direction="row"
      sx={{
        // Одной строкой с прокруткой, а не переносом: три ряда пилюль на
        // телефоне съедали экран до того, как гость видел план.
        gap: 1.25,
        overflowX: 'auto',
        pb: 0.5,
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
      data-testid="room-pills"
    >
      {pills}
    </Stack>
  );
}

/* ── Панели ───────────────────────────────────────────────────────────────── */

function Panels({
  groups,
  readings,
  only,
  canCommand,
  onCommand,
}: {
  groups: Groups;
  readings: Readings;
  /** Телефон показывает одну панель — выбранную вкладкой. */
  only: GroupKey | null;
  canCommand: boolean;
  onCommand: (input: { controlId: string; capability?: string; value?: number | null }) => void;
}) {
  const { t } = useTranslation();
  const keys = (Object.keys(groups) as GroupKey[]).filter(
    (key) => groups[key].length > 0 && (only === null || key === only),
  );

  return (
    <Stack spacing={2}>
      {keys.map((key) => (
        <Panel
          key={key}
          // На телефоне панель уже названа вкладкой, и второй заголовок над
          // ней — просто повтор того же слова другим кеглем.
          title={only === null ? t(`guest.roomControl.tab.${key}`) : null}
          testId={`room-panel-${key}`}
        >
          {key === 'light' ? (
            <LightPanel controls={groups.light} readings={readings} canCommand={canCommand} onCommand={onCommand} />
          ) : key === 'climate' ? (
            <ClimatePanel controls={groups.climate} readings={readings} canCommand={canCommand} onCommand={onCommand} />
          ) : key === 'curtain' ? (
            <CurtainPanel controls={groups.curtain} readings={readings} canCommand={canCommand} onCommand={onCommand} />
          ) : key === 'scene' ? (
            <ScenePanel controls={groups.scene} readings={readings} canCommand={canCommand} onCommand={onCommand} />
          ) : (
            <ServicePanel controls={groups.service} readings={readings} canCommand={canCommand} onCommand={onCommand} />
          )}
        </Panel>
      ))}
    </Stack>
  );
}

function Panel({ title, children, testId }: { title: string | null; children: ReactNode; testId: string }) {
  const { glass } = useStorefront();
  return (
    <Stack
      spacing={1.5}
      data-testid={testId}
      sx={(theme) => ({
        p: 2,
        borderRadius: `${theme.palette.brand.radius.lg}px`,
        ...glass.panel,
      })}
    >
      {title ? (
        <Typography
          variant="caption"
          component="h2"
          sx={{ letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700, color: 'text.secondary' }}
        >
          {title}
        </Typography>
      ) : null}
      {children}
    </Stack>
  );
}

function LightPanel({ controls, readings, canCommand, onCommand }: PanelProps) {
  const { t } = useTranslation();
  const anyOn = controls.some((control) => readingOn(readings[control.controlId]) === true);

  return (
    <>
      <Box>
        {controls.map((control) => (
          <ToggleRow
            key={control.controlId}
            control={control}
            reading={readings[control.controlId]}
            canCommand={canCommand}
            onCommand={onCommand}
            icon={<IconLightGroup size={18} />}
          />
        ))}
      </Box>
      <OutlineWideButton
        icon={<IconPower size={15} />}
        disabled={!anyOn || !canCommand}
        onClick={() => {
          for (const control of controls) {
            if (readingOn(readings[control.controlId]) === true) {
              onCommand({ controlId: control.controlId, capability: 'toggle', value: 0 });
            }
          }
        }}
        testId="room-all-lights-off"
      >
        {t('guest.roomControl.allLightsOff')}
      </OutlineWideButton>
    </>
  );
}

function ClimatePanel({ controls, readings, canCommand, onCommand }: PanelProps) {
  const { t } = useTranslation();
  const control = controls[0];
  const reading = readings[control.controlId];
  const locked = isLocked(reading, canCommand);
  const setpointRange = control.range?.setpoint;
  const fanRange = control.range?.fan_speed;
  const setpoint = reading?.values.setpoint ?? null;
  const current = reading?.values.current_temp ?? null;
  const power = readingOn(reading);
  const fan = reading?.values.fan_speed ?? null;

  const fanOptions = useMemo(() => {
    if (!fanRange) return [];
    const options = [];
    for (let value = fanRange.min; value <= fanRange.max; value += fanRange.step || 1) {
      // `0` подписан «Авто», а не «выкл»: выключение фанкойла это toggle, и
      // путать их нельзя — иначе у гостя две кнопки выключения, одна из
      // которых ничего не выключает.
      options.push({ value, label: value === 0 ? t('guest.roomControl.fanAuto') : String(value) });
    }
    return options;
  }, [fanRange, t]);

  return (
    <>
      {setpoint !== null && setpointRange ? (
        <Box data-swipe-guard sx={{ alignSelf: 'center' }}>
          <RoomDial
            target={setpoint}
            current={current}
            min={setpointRange.min}
            max={setpointRange.max}
            step={setpointRange.step || 1}
            disabled={locked}
            label={t('guest.roomControl.setpoint')}
            captionSetpoint={t('guest.roomControl.setpoint')}
            captionCurrent={t('guest.roomControl.dialCurrent')}
            captionSensor={t('guest.roomControl.dialSensor')}
            decreaseLabel={t('guest.roomControl.decrease')}
            increaseLabel={t('guest.roomControl.increase')}
            onChange={(next) =>
              onCommand({ controlId: control.controlId, capability: 'setpoint', value: next })
            }
            testId={`room-thermostat-${control.controlId}`}
          />
        </Box>
      ) : null}

      {power !== null ? (
        <ToggleRow
          control={control}
          reading={reading}
          canCommand={canCommand}
          onCommand={onCommand}
          icon={<IconAirConditioner size={18} />}
        />
      ) : null}

      {fanOptions.length > 0 ? (
        <Stack direction="row" alignItems="center" spacing={1.5} data-swipe-guard>
          <Typography variant="body2" sx={{ width: 96, flex: 'none', color: 'text.secondary', fontWeight: 600 }}>
            {t('guest.roomControl.fanSpeed')}
          </Typography>
          <Segmented
            fullWidth
            value={fan}
            options={fanOptions}
            // Скорость без включённого фанкойла ничего не значит: сегменты
            // гаснут вместе с ним, как в макете.
            disabled={locked || power !== true}
            label={t('guest.roomControl.fanSpeed')}
            onChange={(next) =>
              onCommand({ controlId: control.controlId, capability: 'fan_speed', value: next })
            }
            testId={`room-fan-${control.controlId}`}
          />
        </Stack>
      ) : null}
    </>
  );
}

function CurtainPanel({ controls, readings, canCommand, onCommand }: PanelProps) {
  const { t } = useTranslation();
  const { roomControl: tokens } = useStorefront();

  return (
    <Box>
      {controls.map((control) => {
        const reading = readings[control.controlId];
        const on = readingOn(reading);
        const locked = isLocked(reading, canCommand);
        const set = (value: number) =>
          onCommand({ controlId: control.controlId, capability: 'toggle', value });

        return (
          <ControlRow
            key={control.controlId}
            testId={`room-control-${control.controlId}`}
            icon={control.kind === 'curtain_blackout' ? <IconBlackout size={18} /> : <IconCurtain size={18} />}
            title={control.title}
            on={on === true}
            busy={reading?.busy}
            disabled={locked}
            pressed={on ?? undefined}
            ariaLabel={`${control.title}: ${stateWord(on, t, 'curtain')}`}
            onClick={() => set(on ? 0 : 1)}
            subtitle={
              <Box component="span" sx={{ display: 'inline-flex', flexDirection: 'column' }}>
                <Box
                  component="span"
                  sx={(theme) => ({
                    fontFamily: theme.typography.h1.fontFamily,
                    fontWeight: 700,
                    fontSize: 13,
                    letterSpacing: '.04em',
                    textTransform: 'uppercase',
                    color: on ? tokens.accent : 'text.secondary',
                  })}
                >
                  {stateWord(on, t, 'curtain')}
                </Box>
                <Box component="span" sx={{ color: 'text.disabled' }}>
                  {reading?.busy
                    ? t('guest.roomControl.running')
                    : on
                      ? t('guest.roomControl.curtainHintClose')
                      : t('guest.roomControl.curtainHintOpen')}
                </Box>
              </Box>
            }
            action={
              <Box data-swipe-guard>
                <CurtainArrows
                  open={on}
                  disabled={locked}
                  onOpen={() => set(1)}
                  onClose={() => set(0)}
                  openLabel={t('guest.roomControl.open')}
                  closeLabel={t('guest.roomControl.close')}
                  testId={`room-curtain-arrows-${control.controlId}`}
                />
              </Box>
            }
          />
        );
      })}
    </Box>
  );
}

function ScenePanel({ controls, readings, canCommand, onCommand }: PanelProps) {
  return (
    <Box
      data-swipe-guard
      sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.25 }}
    >
      {controls.map((control) => {
        const reading = readings[control.controlId];
        return (
          <SceneTile
            key={control.controlId}
            icon={<IconScene size={22} />}
            label={control.title}
            // Сцена НИКОГДА не показывается включённой: подтверждать нечего —
            // тега F_Scene_* на объекте не существует.
            active={false}
            disabled={isLocked(reading, canCommand)}
            onClick={() => onCommand({ controlId: control.controlId, capability: 'trigger' })}
            testId={`room-control-${control.controlId}`}
          />
        );
      })}
    </Box>
  );
}

function ServicePanel({ controls, readings, canCommand, onCommand }: PanelProps) {
  return (
    <Box>
      {controls.map((control) => (
        <ToggleRow
          key={control.controlId}
          control={control}
          reading={readings[control.controlId]}
          canCommand={canCommand}
          onCommand={onCommand}
          icon={iconForService(control.kind)}
        />
      ))}
    </Box>
  );
}

/* ── Строка-тумблер ───────────────────────────────────────────────────────── */

function ToggleRow({
  control,
  reading,
  canCommand,
  onCommand,
  icon,
}: {
  control: RoomControl;
  reading: Reading | undefined;
  canCommand: boolean;
  onCommand: (input: { controlId: string; capability?: string; value?: number | null }) => void;
  icon: ReactNode;
}) {
  const { t } = useTranslation();
  const on = readingOn(reading);
  const locked = isLocked(reading, canCommand);

  return (
    <ControlRow
      testId={`room-control-${control.controlId}`}
      icon={icon}
      title={control.title}
      on={on === true}
      busy={reading?.busy}
      disabled={locked}
      // Состояния нет — нет и `aria-pressed`. Пока идёт обмен состояние ЕСТЬ:
      // это последнее подтверждённое, и подменять его выключенным нельзя.
      pressed={on ?? undefined}
      ariaLabel={`${control.title}: ${stateWord(on, t, 'switch')}`}
      subtitle={
        reading?.busy
          ? t('guest.roomControl.running')
          : reading?.unreadable
            ? t('guest.roomControl.offline')
            : stateWord(on, t, 'switch')
      }
      onClick={() => onCommand({ controlId: control.controlId, capability: 'toggle', value: on ? 0 : 1 })}
      action={<RowSwitch on={on === true} dimmed={reading?.busy || on === null} />}
    />
  );
}

/* ── Чтение состояния ─────────────────────────────────────────────────────── */

export interface Reading {
  control: RoomControl;
  /** ПОСЛЕДНИЕ ПОДТВЕРЖДЁННЫЕ значения. Пусто — состояние не читается. */
  values: Partial<Record<RoomCapability, number>>;
  busy: boolean;
  unreadable: boolean;
  readonly: boolean;
}

export type Readings = Record<string, Reading>;

function readingOn(reading: Reading | undefined): boolean | null {
  if (!reading || reading.values.toggle === undefined) return null;
  return reading.values.toggle === 1;
}

function isLocked(reading: Reading | undefined, canCommand: boolean): boolean {
  if (!reading) return true;
  return reading.busy || reading.unreadable || reading.readonly || !canCommand;
}

function stateWord(on: boolean | null, t: TFunction, kind: 'switch' | 'curtain'): string {
  if (on === null) return t('guest.roomControl.offline');
  if (kind === 'curtain') {
    return on ? t('guest.roomControl.stateOpen') : t('guest.roomControl.stateClosed');
  }
  return on ? t('guest.roomControl.stateOn') : t('guest.roomControl.stateOff');
}

/**
 * Чтение по каждому элементу с ПАМЯТЬЮ последнего подтверждённого значения.
 *
 * Ради этой памяти хук и существует. Сервер в полёте значений не отдаёт — он
 * их не перечитывал, — и без памяти список рисовал бы элемент ВЫКЛЮЧЕННЫМ на
 * время обмена: гость нажимал «включить», видел, как свет гаснет на экране, и
 * через секунду загорается. Это враньё, и оно жило на экране с G5a: плану
 * память завели, а списку — нет.
 *
 * Память стирается, как только элемент ушёл в `offline`: там состояния нет, и
 * «что было» — ровно то враньё, ради запрета которого написан весь экран.
 */
function useRoomReadings(snapshot: RoomStateSnapshot | undefined): Readings {
  const memory = useRef<Record<string, Partial<Record<RoomCapability, number>>>>({});

  return useMemo(() => {
    const readings: Readings = {};
    for (const zone of snapshot?.zones ?? []) {
      for (const control of zone.controls) {
        const id = control.controlId;
        if (control.state === 'confirmed') {
          const values: Partial<Record<RoomCapability, number>> = {};
          for (const capability of control.capabilities) {
            const value = readValue(control, capability);
            if (value !== null) values[capability] = value;
          }
          memory.current[id] = values;
        } else if (control.state === 'offline') {
          delete memory.current[id];
        }
        readings[id] = {
          control,
          values: control.state === 'offline' ? {} : (memory.current[id] ?? {}),
          busy: control.state === 'pending',
          unreadable: control.state === 'offline',
          readonly: control.readonly,
        };
      }
    }
    return readings;
  }, [snapshot]);
}

/** Чтение для плиты плана — тот же источник, что и у списка. */
function planReadings(readings: Readings): Record<string, PlanReading> {
  const out: Record<string, PlanReading> = {};
  for (const [id, reading] of Object.entries(readings)) {
    out[id] = {
      title: reading.control.title,
      on: readingOn(reading),
      fan: reading.values.fan_speed ?? null,
      pending: reading.busy,
      disabled: reading.busy || reading.unreadable || reading.readonly,
    };
  }
  return out;
}

/** Значение ручки: скаляр у простого элемента, поле объекта у составного. */
function readValue(control: RoomControl, capability: RoomCapability): number | null {
  const key = capability === 'toggle' ? 'on' : capability;
  if (control.value === null || control.value === undefined) return null;
  if (typeof control.value === 'number') {
    return control.capabilities.length === 1 ? control.value : null;
  }
  const found = control.value[key];
  return typeof found === 'number' ? found : null;
}

/* ── Группировка по типу ──────────────────────────────────────────────────── */

export type GroupKey = 'light' | 'climate' | 'curtain' | 'scene' | 'service';
export type Groups = Record<GroupKey, RoomControl[]>;

interface PanelProps {
  controls: RoomControl[];
  readings: Readings;
  canCommand: boolean;
  onCommand: (input: { controlId: string; capability?: string; value?: number | null }) => void;
}

/**
 * Раскладка элементов по панелям: свет, климат, шторы, сцены, сервис.
 *
 * Там, где вид элемента виден по CAPABILITY, решает она: уставка — климат,
 * триггер — сцена. Свет от шторы и от сервиса capability не отличает (у всех
 * один `toggle`), и там решает `kind` — код каталога, который ровно и говорит,
 * ЧЕМ элемент является. Это по-прежнему решение о показе, а не о поведении:
 * команда собирается из capability, и ни одна ветка отправки на kind не
 * смотрит.
 */
function groupControls(zones: RoomZone[]): Groups {
  const groups: Groups = { light: [], climate: [], curtain: [], scene: [], service: [] };
  for (const zone of zones) {
    for (const control of zone.controls) {
      if (control.capabilities.includes('setpoint')) groups.climate.push(control);
      else if (control.capabilities.includes('trigger')) groups.scene.push(control);
      else if (control.kind.startsWith('light')) groups.light.push(control);
      else if (control.kind.startsWith('curtain')) groups.curtain.push(control);
      else groups.service.push(control);
    }
  }
  return groups;
}

function iconForService(kind: string) {
  if (kind === 'dnd') return <IconDoNotDisturb size={18} />;
  if (kind === 'mur') return <IconMakeUpRoom size={18} />;
  return <IconSwitch size={18} />;
}

/* ── Раскладка ────────────────────────────────────────────────────────────── */

function RoomSkeleton() {
  return (
    <Stack spacing={2} sx={{ pt: 2 }} data-testid="room-skeleton">
      <SkeletonLine width="42%" height={18} />
      <Stack direction="row" spacing={1.5}>
        <SkeletonCard />
        <SkeletonCard />
      </Stack>
    </Stack>
  );
}

/**
 * Высота элемента, на которую опирается чужое липкое позиционирование.
 *
 * Измеряется, а не берётся константой: плита сжимается при скролле, и вкладки
 * обязаны ехать за её нижним краем, а не за когда-то подобранным числом.
 */
function useMeasuredHeight() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, height };
}

/**
 * Сжатие липкой плиты при скролле.
 *
 * Уменьшается ШИРИНА, пропорции сохраняются — поэтому окна зон, заданные в
 * процентах от кадра, остаются выровненными сами собой. Числа из словаря.
 */
function usePlanShrink(active: boolean): number {
  const [width, setWidth] = useState(100);

  useEffect(() => {
    if (!active) {
      setWidth(100);
      return;
    }
    let scheduled = false;
    const apply = () => {
      scheduled = false;
      const progress = Math.min(window.scrollY / layout.planShrinkScroll, 1);
      setWidth(100 - layout.planShrink * 100 * progress);
    };
    const onScroll = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [active]);

  return width;
}

/* ── Слабая сессия: форма PIN прямо на экране ─────────────────────────────── */

/** «Осталась одна попытка» / «попробуйте через N минут» — из тела ответа. */
function attemptsHint(error: unknown, t: TFunction): string {
  if (!(error instanceof ApiError)) return '';
  const left = error.payload.attempts_left;
  if (typeof left === 'number') return t('guest.roomControl.pinAttempts', { count: left });
  return '';
}

/**
 * Форма ввода PIN живёт НА САМОМ ЭКРАНЕ, а не редиректом в отдельный шаг:
 * гость пришёл сюда управлять номером, и увести его на пустую страницу «нужно
 * подтвердиться» значит потерять контекст ровно в тот момент, когда он понятен.
 */
function PinPanel() {
  const { t } = useTranslation();
  const { glass } = useStorefront();
  const verify = useRoomVerify();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    verify.mutate(
      { pin },
      {
        // Сколько попыток осталось — говорим честно. Молчаливый счётчик
        // приводит к тому, что гость упирается в блокировку внезапно.
        onError: (err) => setError([errorMessage(err, t), attemptsHint(err, t)].filter(Boolean).join(' ')),
        onSuccess: () => setPin(''),
      },
    );
  };

  return (
    <Stack
      spacing={1.5}
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      sx={(theme) => ({
        p: 2,
        borderRadius: `${theme.palette.brand.radius.lg}px`,
        ...glass.panel,
      })}
      data-testid="room-pin-panel"
    >
      <Typography variant="subtitle1">{t('guest.roomControl.pinTitle')}</Typography>
      <Typography variant="body2" color="text.secondary">
        {t('guest.roomControl.pinHint')}
      </Typography>
      <TextField
        value={pin}
        onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
        label={t('guest.roomControl.pinLabel')}
        inputMode="numeric"
        autoComplete="one-time-code"
        size="small"
        error={Boolean(error)}
        helperText={error ?? ' '}
        inputProps={{ 'data-testid': 'room-pin-input' }}
      />
      <Button
        type="submit"
        variant="contained"
        disabled={pin.length < 4 || verify.isPending}
        data-testid="room-pin-submit"
      >
        {t('guest.roomControl.pinSubmit')}
      </Button>
    </Stack>
  );
}
