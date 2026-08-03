import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { ApiError } from '@/api/client';

import {
  FanSpeed,
  KitEmptyState,
  KitToast,
  LargeToggle,
  OfflineIndicator,
  RunningIndicator,
  SceneButton,
  SkeletonCard,
  SkeletonLine,
  Thermostat,
} from '@/kit';
import { ActionButton } from '@/kit/room';
import { IconCurtain, IconOffline, IconRoom, IconScene, IconSwitch } from '@/icons';
import { errorMessage } from '../errors';
import { useRoomCommand, useRoomLive, useRoomState, useRoomVerify } from '../hooks/useRoomControl';
import { useGuestSession } from '../session/GuestSessionProvider';
import { layout, stickyUnderFloating } from '../storefrontTokens';
import { useStorefront } from '../useStorefront';
import type { RoomCapability, RoomControl, RoomStateSnapshot } from '../api/types';

/**
 * Экран управления номером.
 *
 * Два правила, из которых следует почти вся остальная механика:
 *
 * 1. ВЕТВЛЕНИЕ ПО CAPABILITY, никогда по `kind` и никогда по `controlId`.
 *    `kind` используется ровно для иконки. Причина в ТЗ §1: GRMS другого
 *    производителя обязан подключиться без правки гостевого интерфейса, а у
 *    другого вендора отопление вполне может оказаться отдельным элементом с
 *    той же ручкой уставки.
 *
 * 2. ОПТИМИСТИЧНЫХ ПЕРЕКЛЮЧЕНИЙ НЕТ. Состояние меняется только после
 *    подтверждения. Пока команда в полёте — «в процессе» и элемент заблокирован;
 *    не подтвердилась — элемент возвращается к ФАКТИЧЕСКОМУ состоянию с честной
 *    подписью, а не к желаемому.
 *
 * Своих цветов и своих слоёв стекла здесь нет: всё из `useStorefront()` и
 * токенов — R7 лечил ровно ту болезнь, которую новый экран иначе унаследовал бы.
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

  const header = (
    <Stack
      spacing={0.5}
      sx={{
        // Липкая шапка пинится ПОД плавающей группой контролов, а не в top: 0.
        // Число берётся из словаря: группа и липкие поверхности уже однажды
        // столкнулись в одной полосе, и лечится это не по месту.
        position: 'sticky',
        top: stickyUnderFloating,
        zIndex: 2,
        px: 2,
        pt: 2,
        pb: `${layout.panelOverlap}px`,
        ...glass.bar,
      }}
    >
      <Typography variant="h5" component="h1">
        {t('guest.roomControl.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('guest.roomControl.subtitle')}
      </Typography>
    </Stack>
  );

  if (!enabled) {
    // Сюда обычно не попасть — пункта навигации нет, — но прямой заход по
    // адресу возможен, и он обязан упереться в тот же ответ, что и сервер.
    return (
      <Box sx={{ pb: 4 }}>
        {header}
        <KitEmptyState
          icon={<IconOffline size={28} />}
          title={t('guest.roomControl.unavailable')}
          testId="room-unavailable"
        />
      </Box>
    );
  }

  return (
    <Box sx={{ pb: 6 }} data-testid="room-page">
      {header}

      {state.isPending ? <RoomSkeleton /> : null}

      {!state.isPending && state.isError ? (
        <Box sx={{ px: 2, pt: 2 }}>
          <KitToast severity="error" message={errorMessage(state.error, t)} testId="room-error" />
        </Box>
      ) : null}

      {snapshot ? (
        <RoomBody
          snapshot={snapshot}
          liveOffline={live.status === 'offline'}
          notice={notice}
          onDismissNotice={() => setNotice(null)}
          onCommand={send}
        />
      ) : null}
    </Box>
  );
}

function RoomSkeleton() {
  return (
    <Stack spacing={2} sx={{ px: 2, pt: 2 }} data-testid="room-skeleton">
      <SkeletonLine width="42%" height={18} />
      <Stack direction="row" spacing={1.5}>
        <SkeletonCard />
        <SkeletonCard />
      </Stack>
      <SkeletonLine width="36%" height={18} />
      <Stack direction="row" spacing={1.5}>
        <SkeletonCard />
        <SkeletonCard />
      </Stack>
    </Stack>
  );
}

function RoomBody({
  snapshot,
  liveOffline,
  notice,
  onDismissNotice,
  onCommand,
}: {
  snapshot: RoomStateSnapshot;
  liveOffline: boolean;
  notice: { severity: 'success' | 'warning' | 'error'; text: string } | null;
  onDismissNotice: () => void;
  onCommand: (input: { controlId: string; capability?: string; value?: number | null }) => void;
}) {
  const { t } = useTranslation();
  const { glass } = useStorefront();

  if (snapshot.availability === 'unavailable') {
    // Нейтральный текст и НИ ОДНОГО значения: элемент без связи состояния не
    // имеет, и показать «что было» здесь означало бы показать неправду.
    return (
      <KitEmptyState
        icon={<IconOffline size={28} />}
        title={snapshot.message ?? t('guest.roomControl.unavailable')}
        testId="room-unavailable"
      />
    );
  }

  const zones = snapshot.zones.filter((zone) => zone.controls.length > 0);
  if (zones.length === 0) {
    return (
      <KitEmptyState
        icon={<IconRoom size={28} />}
        title={t('guest.roomControl.empty')}
        description={t('guest.roomControl.emptyHint')}
        testId="room-empty"
      />
    );
  }

  return (
    <Stack spacing={3} sx={{ px: 2, pt: 2 }}>
      {!snapshot.can_command ? <PinPanel /> : null}

      {liveOffline ? (
        <KitToast severity="info" message={t('guest.roomControl.liveOffline')} testId="room-live-offline" />
      ) : null}

      {notice ? (
        <KitToast
          severity={notice.severity}
          message={notice.text}
          action={
            <Button size="small" onClick={onDismissNotice}>
              {t('guest.common.close')}
            </Button>
          }
          testId="room-notice"
        />
      ) : null}

      {zones.map((zone) => (
        <Stack key={zone.code || 'default'} spacing={1.5} data-testid={`room-zone-${zone.code || 'default'}`}>
          {zone.title ? (
            <Typography variant="subtitle2" color="text.secondary">
              {zone.title}
            </Typography>
          ) : null}
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              // Плитки не тянутся по высоте самого высокого соседа: рядом с
              // климатом они иначе вырастают втрое и перестают читаться как
              // плитки.
              alignItems: 'flex-start',
              gap: 1.5,
              p: 1.5,
              borderRadius: (theme) => `${theme.palette.brand.radius.lg}px`,
              ...glass.panel,
            }}
          >
            {zone.controls.map((control) => (
              <Control
                key={control.controlId}
                control={control}
                canCommand={snapshot.can_command}
                onCommand={onCommand}
              />
            ))}
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

/* ── Один элемент ─────────────────────────────────────────────────────────── */

function has(control: RoomControl, capability: RoomCapability): boolean {
  return control.capabilities.includes(capability);
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

function Control({
  control,
  canCommand,
  onCommand,
}: {
  control: RoomControl;
  canCommand: boolean;
  onCommand: (input: { controlId: string; capability?: string; value?: number | null }) => void;
}) {
  const { t } = useTranslation();
  const pending = control.state === 'pending';
  const offline = control.state === 'offline';
  const locked = pending || offline || !canCommand || control.readonly;

  const hint = pending ? (
    <RunningIndicator label={t('guest.roomControl.running')} testId={`room-running-${control.controlId}`} />
  ) : offline ? (
    <OfflineIndicator label={t('guest.roomControl.offline')} testId={`room-offline-${control.controlId}`} />
  ) : null;

  // Составной элемент (кондиционер) — ОДИН controlId с несколькими ручками.
  // Определяем его по НАБОРУ CAPABILITY, а не по kind.
  if (has(control, 'setpoint')) {
    return (
      <ClimateControl control={control} locked={locked} hint={hint} onCommand={onCommand} />
    );
  }

  if (has(control, 'trigger')) {
    // Сцена: состояния нет и «включённой» она не показывается никогда.
    return (
      <SceneButton
        icon={<IconScene size={22} />}
        label={control.title}
        disabled={locked}
        onClick={() => onCommand({ controlId: control.controlId, capability: 'trigger' })}
        testId={`room-control-${control.controlId}`}
        hint={hint}
      />
    );
  }

  if (has(control, 'toggle')) {
    const value = readValue(control, 'toggle');
    const on = value === 1;
    return (
      <ActionButton
        icon={iconFor(control.kind)}
        label={control.title}
        active={on}
        pressed={offline || pending ? undefined : on}
        disabled={locked}
        ariaLabel={`${control.title}: ${on ? t('guest.roomControl.on') : t('guest.roomControl.off')}`}
        onClick={() => onCommand({ controlId: control.controlId, capability: 'toggle', value: on ? 0 : 1 })}
        testId={`room-control-${control.controlId}`}
        hint={hint}
      />
    );
  }

  return null;
}

function ClimateControl({
  control,
  locked,
  hint,
  onCommand,
}: {
  control: RoomControl;
  locked: boolean;
  hint: ReactNode;
  onCommand: (input: { controlId: string; capability?: string; value?: number | null }) => void;
}) {
  const { t } = useTranslation();
  const setpointRange = control.range?.setpoint;
  const setpoint = readValue(control, 'setpoint');
  const currentTemp = has(control, 'current_temp') ? readValue(control, 'current_temp') : null;
  const power = has(control, 'toggle') ? readValue(control, 'toggle') : null;
  const fan = has(control, 'fan_speed') ? readValue(control, 'fan_speed') : null;
  const fanRange = control.range?.fan_speed;

  // Сегменты собираются ИЗ ДИАПАЗОНА, приехавшего с сервера: ни 0, ни 3 на
  // фронте не зашиты. `0` подписан «Авто», а не «выкл» — выключение фанкойла
  // это toggle, и путать их нельзя.
  const fanOptions = useMemo(() => {
    if (!fanRange) return [];
    const options = [];
    for (let value = fanRange.min; value <= fanRange.max; value += fanRange.step || 1) {
      options.push({
        value,
        label: value === 0 ? t('guest.roomControl.fanAuto') : String(value),
      });
    }
    return options;
  }, [fanRange, t]);

  return (
    <Stack
      spacing={1.5}
      alignItems="center"
      sx={{ p: 1.5, minWidth: 220 }}
      data-testid={`room-control-${control.controlId}`}
    >
      <Typography variant="subtitle2">{control.title}</Typography>

      {setpoint !== null && setpointRange ? (
        <Thermostat
          current={currentTemp}
          target={setpoint}
          min={setpointRange.min}
          max={setpointRange.max}
          step={setpointRange.step || 1}
          disabled={locked}
          label={t('guest.roomControl.setpoint')}
          decreaseLabel={t('guest.roomControl.decrease')}
          increaseLabel={t('guest.roomControl.increase')}
          onChange={(next) =>
            onCommand({ controlId: control.controlId, capability: 'setpoint', value: next })
          }
          testId={`room-thermostat-${control.controlId}`}
        />
      ) : null}

      {power !== null ? (
        <LargeToggle
          on={power === 1}
          disabled={locked}
          label={power === 1 ? t('guest.roomControl.on') : t('guest.roomControl.off')}
          ariaLabel={control.title}
          onChange={(next) =>
            onCommand({ controlId: control.controlId, capability: 'toggle', value: next ? 1 : 0 })
          }
          testId={`room-power-${control.controlId}`}
        />
      ) : null}

      {fanOptions.length > 0 ? (
        <FanSpeed
          value={fan}
          options={fanOptions}
          disabled={locked}
          label={t('guest.roomControl.fanSpeed')}
          onChange={(next) =>
            onCommand({ controlId: control.controlId, capability: 'fan_speed', value: next })
          }
          testId={`room-fan-${control.controlId}`}
        />
      ) : null}

      {hint}
    </Stack>
  );
}

/**
 * Иконка по `kind` — ЕДИНСТВЕННОЕ, на что `kind` влияет. Ни одно решение о
 * поведении элемента по нему не принимается.
 */
function iconFor(kind: string) {
  if (kind === 'curtain' || kind === 'curtain_blackout') return <IconCurtain size={22} />;
  if (kind === 'scene') return <IconScene size={22} />;
  return <IconSwitch size={22} />;
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
        // приводит к тому, что гость упирается в блокировку внезапно и идёт на
        // ресепшен уже раздражённым; про саму блокировку сервер сообщает
        // временем ожидания, и его тоже показываем.
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
      sx={{
        p: 2,
        borderRadius: (theme) => `${theme.palette.brand.radius.lg}px`,
        ...glass.panel,
      }}
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
