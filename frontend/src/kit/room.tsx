import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';

import { IconRunning, IconOffline } from '@/icons';

/**
 * Room-controls kit — VISUAL ONLY. No logic, no backend, no live state: these
 * components take their reading as props and render it. They lock the visual
 * language so the future room-control phase drops straight in.
 */

function ControlLabel({ children }: { children: ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
      {children}
    </Typography>
  );
}

/* ── Ring dimmer (circular) ───────────────────────────────────────────────── */

export interface RingDimmerProps {
  /** 0..100 brightness. */
  value: number;
  label?: string;
  center?: ReactNode;
  size?: number;
  testId?: string;
}

export function RingDimmer({ value, label, center, size = 132, testId = 'room-ring-dimmer' }: RingDimmerProps) {
  const theme = useTheme();
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const r = 52;
  const circ = 2 * Math.PI * r;
  return (
    <Stack spacing={1} alignItems="center" data-testid={testId}>
      <Box sx={{ position: 'relative', width: size, height: size }}>
        <Box
          component="svg"
          viewBox="0 0 120 120"
          sx={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}
        >
          <circle cx="60" cy="60" r={r} fill="none" stroke={theme.palette.divider} strokeWidth={10} />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={theme.palette.primary.main}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - pct)}
          />
        </Box>
        <Stack
          sx={{ position: 'absolute', inset: 0 }}
          alignItems="center"
          justifyContent="center"
          spacing={0}
        >
          {center ?? (
            <Typography
              variant="h4"
              component="span"
              sx={{ fontFamily: theme.typography.h1.fontFamily }}
            >
              {Math.round(value)}%
            </Typography>
          )}
        </Stack>
      </Box>
      {label ? <ControlLabel>{label}</ControlLabel> : null}
    </Stack>
  );
}

/* ── Position slider (curtains / blinds) ──────────────────────────────────── */

export interface PositionSliderProps {
  /** 0 = closed, 100 = fully open. */
  value: number;
  label?: string;
  height?: number;
  testId?: string;
}

export function PositionSlider({ value, label, height = 132, testId = 'room-position-slider' }: PositionSliderProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <Stack spacing={1} alignItems="center" data-testid={testId}>
      <Box
        sx={(theme) => ({
          position: 'relative',
          width: 56,
          height,
          borderRadius: `${theme.palette.brand.radius.md}px`,
          bgcolor: theme.palette.brand.surfaceMuted,
          border: 1,
          borderColor: 'divider',
          overflow: 'hidden',
        })}
      >
        {/* Filled portion = closed part, drawn from the top. */}
        <Box
          sx={(theme) => ({
            position: 'absolute',
            insetInline: 0,
            top: 0,
            height: `${100 - pct}%`,
            background: `linear-gradient(${theme.palette.primary.main}, ${theme.palette.brand.primaryStrong})`,
          })}
        />
        {/* Handle. */}
        <Box
          sx={{
            position: 'absolute',
            insetInline: 0,
            top: `calc(${100 - pct}% - 3px)`,
            height: 6,
            bgcolor: 'background.paper',
            boxShadow: 1,
          }}
        />
      </Box>
      {label ? <ControlLabel>{label}</ControlLabel> : null}
    </Stack>
  );
}

/* ── Thermostat (current + target) ────────────────────────────────────────── */

export interface ThermostatProps {
  /**
   * Текущая температура из feedback. `null` — переменной нет или её не
   * прочитали: блок текущей НЕ рисуется вовсе, а не показывает «—» или 0.
   */
  current?: number | null;
  target: number;
  unit?: string;
  min?: number;
  max?: number;
  /**
   * Уставка изменилась. Без него диск остаётся витринным, каким и был: до G5
   * кит только отображал, и три компонента из семи не имели колбэка вовсе.
   */
  onChange?: (next: number) => void;
  step?: number;
  disabled?: boolean;
  label?: string;
  size?: number;
  testId?: string;
  decreaseLabel?: string;
  increaseLabel?: string;
}

/**
 * Диск уставки. `max` по умолчанию 32, а не 30: диапазон приезжает из
 * переменной типа номера (`16-32` в Excel ПНР), и прежнее умолчание обрезало
 * бы две доступные гостю ступени.
 *
 * Доступность здесь не «галочка»: диском обязано быть можно пользоваться с
 * клавиатуры, поэтому это настоящая группа со `role="spinbutton"`,
 * `aria-value*` и стрелками, плюс две видимые кнопки — на телефоне попасть в
 * дугу пальцем куда труднее, чем в кнопку.
 */
export function Thermostat({
  current = null,
  target,
  unit = '°',
  min = 16,
  max = 32,
  onChange,
  step = 1,
  disabled = false,
  label,
  size = 148,
  testId = 'room-thermostat',
  decreaseLabel,
  increaseLabel,
}: ThermostatProps) {
  const theme = useTheme();
  const span = Math.max(1, max - min);
  const pct = Math.max(0, Math.min(1, (target - min) / span));
  const r = 52;
  const circ = 2 * Math.PI * r;
  // Draw a 270° gauge (three quarters) for the target.
  const gauge = 0.75;
  const interactive = Boolean(onChange) && !disabled;

  const shift = (delta: number) => {
    if (!interactive) return;
    const next = Math.max(min, Math.min(max, target + delta));
    if (next !== target) onChange?.(next);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const map: Record<string, number> = {
      ArrowUp: step,
      ArrowRight: step,
      ArrowDown: -step,
      ArrowLeft: -step,
      PageUp: step * 2,
      PageDown: -step * 2,
    };
    if (event.key in map) {
      event.preventDefault();
      shift(map[event.key]);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      onChange?.(min);
    }
    if (event.key === 'End') {
      event.preventDefault();
      onChange?.(max);
    }
  };

  return (
    <Stack spacing={1} alignItems="center" data-testid={testId}>
      <Stack direction="row" spacing={1} alignItems="center">
        {interactive ? (
          <DialStep
            sign="-"
            ariaLabel={decreaseLabel ?? 'Убавить'}
            onClick={() => shift(-step)}
            disabled={target <= min}
            testId={`${testId}-minus`}
          />
        ) : null}
        <Box
          role={interactive ? 'spinbutton' : undefined}
          tabIndex={interactive ? 0 : undefined}
          aria-valuenow={target}
          aria-valuemin={interactive ? min : undefined}
          aria-valuemax={interactive ? max : undefined}
          aria-valuetext={interactive ? `${Math.round(target)}${unit}` : undefined}
          aria-label={interactive ? label : undefined}
          aria-disabled={disabled || undefined}
          onKeyDown={onKeyDown}
          sx={(th) => ({
            position: 'relative',
            width: size,
            height: size,
            borderRadius: '50%',
            opacity: disabled ? 0.5 : 1,
            '&:focus-visible': {
              outline: `2px solid ${th.palette.primary.main}`,
              outlineOffset: 4,
            },
          })}
        >
          <Box
            component="svg"
            viewBox="0 0 120 120"
            aria-hidden
            sx={{ width: '100%', height: '100%', transform: 'rotate(135deg)' }}
          >
            <circle
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={theme.palette.divider}
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={`${circ * gauge} ${circ}`}
            />
            <circle
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={theme.palette.warning.main}
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={`${circ * gauge * pct} ${circ}`}
            />
          </Box>
          <Stack sx={{ position: 'absolute', inset: 0 }} alignItems="center" justifyContent="center">
            <Typography
              variant="h3"
              component="span"
              sx={{ fontFamily: theme.typography.h1.fontFamily, lineHeight: 1 }}
            >
              {Math.round(target)}
              {unit}
            </Typography>
            {/* Текущая температура рисуется, ТОЛЬКО если она есть. Не
                связана переменная — блока нет вовсе, а не «—». */}
            {current !== null && current !== undefined ? (
              <Typography variant="caption" color="text.secondary">
                {Math.round(current)}
                {unit}
              </Typography>
            ) : null}
          </Stack>
        </Box>
        {interactive ? (
          <DialStep
            sign="+"
            ariaLabel={increaseLabel ?? 'Прибавить'}
            onClick={() => shift(step)}
            disabled={target >= max}
            testId={`${testId}-plus`}
          />
        ) : null}
      </Stack>
      {label ? <ControlLabel>{label}</ControlLabel> : null}
    </Stack>
  );
}

function DialStep({
  sign,
  ariaLabel,
  onClick,
  disabled,
  testId,
}: {
  sign: '-' | '+';
  ariaLabel: string;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <ButtonBase
      component="button"
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      sx={(theme) => ({
        width: 40,
        height: 40,
        borderRadius: '50%',
        border: 1,
        borderColor: 'divider',
        color: 'text.primary',
        fontSize: 20,
        lineHeight: 1,
        '&:disabled': { opacity: 0.4 },
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      {sign === '-' ? '−' : '+'}
    </ButtonBase>
  );
}

/* ── Fan speed segments ───────────────────────────────────────────────────── */

export interface FanSpeedProps {
  /** 0 — АВТО, а не «выключено». Выключение фанкойла — это toggle. */
  value: number | null;
  options: { value: number; label: string }[];
  onChange?: (next: number) => void;
  disabled?: boolean;
  label?: string;
  testId?: string;
}

/**
 * Сегменты скорости вентилятора. Компонента не было вовсе — единственная
 * capability из словаря, которую кит не закрывал ничем.
 *
 * `0` подписывается «Авто» и это не косметика: в Excel ПНР `0 - Auto`, и
 * показать его как «выкл» значило бы дать гостю две разные кнопки выключения,
 * одна из которых ничего не выключает.
 */
export function FanSpeed({
  value,
  options,
  onChange,
  disabled = false,
  label,
  testId = 'room-fan-speed',
}: FanSpeedProps) {
  return (
    <Stack spacing={1} alignItems="center" data-testid={testId}>
      <Stack
        direction="row"
        role="group"
        aria-label={label}
        sx={(theme) => ({
          p: 0.5,
          gap: 0.5,
          borderRadius: `${theme.palette.brand.radius.pill}px`,
          bgcolor: theme.palette.brand.surfaceMuted,
          opacity: disabled ? 0.5 : 1,
        })}
      >
        {options.map((option) => {
          const active = value === option.value;
          return (
            <ButtonBase
              key={option.value}
              component="button"
              type="button"
              // Настоящая кнопка с aria-pressed, а не div с onClick: экранный
              // диктор обязан сказать, какая скорость выбрана.
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange?.(option.value)}
              data-testid={`${testId}-${option.value}`}
              sx={(theme) => ({
                minWidth: 48,
                minHeight: 36,
                px: 1.5,
                borderRadius: `${theme.palette.brand.radius.pill}px`,
                bgcolor: active ? 'primary.main' : 'transparent',
                color: active ? 'primary.contrastText' : 'text.secondary',
                fontSize: theme.typography.caption.fontSize,
                transition: 'background-color .2s',
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                '&.Mui-focusVisible': {
                  outline: `2px solid ${theme.palette.primary.main}`,
                  outlineOffset: 2,
                },
              })}
            >
              {option.label}
            </ButtonBase>
          );
        })}
      </Stack>
      {label ? <ControlLabel>{label}</ControlLabel> : null}
    </Stack>
  );
}

/* ── Large toggle switch ──────────────────────────────────────────────────── */

export interface LargeToggleProps {
  on: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  ariaLabel?: string;
  testId?: string;
}

export function LargeToggle({
  on,
  onChange,
  disabled = false,
  label,
  ariaLabel,
  testId = 'room-toggle',
}: LargeToggleProps) {
  return (
    <Stack spacing={1} alignItems="center" data-testid={testId}>
      <ButtonBase
        component="button"
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        onClick={() => onChange?.(!on)}
        sx={(theme) => ({
          '&:disabled': { opacity: 0.55 },
          width: 76,
          height: 44,
          borderRadius: `${theme.palette.brand.radius.pill}px`,
          bgcolor: on ? 'primary.main' : theme.palette.brand.surfaceMuted,
          border: 1,
          borderColor: on ? 'primary.main' : 'divider',
          boxShadow: on ? theme.palette.brand.elevation.glow : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: on ? 'flex-end' : 'flex-start',
          px: 0.5,
          transition: 'background-color .2s, justify-content .2s',
          '&.Mui-focusVisible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        })}
      >
        <Box
          aria-hidden
          sx={(theme) => ({
            width: 34,
            height: 34,
            borderRadius: '50%',
            bgcolor: on ? 'primary.contrastText' : 'background.paper',
            boxShadow: theme.palette.brand.elevation.sm,
          })}
        />
      </ButtonBase>
      {label ? <ControlLabel>{label}</ControlLabel> : null}
    </Stack>
  );
}

/* ── Action button (for unreadable state) & scene button ──────────────────── */

export interface RoomTileButtonProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  /**
   * Состояние переключателя для экранного диктора. Задаётся ТОЛЬКО там, где
   * состояние есть: у сцены его нет и быть не может — feedback'а у сцены не
   * существует, и `aria-pressed` на ней означал бы обещание, которого нечем
   * подкрепить.
   */
  pressed?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  onClick?: () => void;
  testId?: string;
  /** Подпись состояния под плиткой: «в процессе», «нет связи», «не удалось». */
  hint?: ReactNode;
}

/** Generic pressable tile — used for an action whose state isn't readable. */
export function ActionButton({
  icon,
  label,
  active = false,
  pressed,
  disabled = false,
  ariaLabel,
  onClick,
  testId = 'room-action',
  hint,
}: RoomTileButtonProps) {
  return (
    <ButtonBase
      component="button"
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      focusRipple
      data-testid={testId}
      sx={(theme) => ({
        flexDirection: 'column',
        gap: 0.75,
        width: 104,
        minHeight: 104,
        p: 1.5,
        borderRadius: `${theme.palette.brand.radius.lg}px`,
        border: 1,
        borderColor: active ? 'primary.main' : 'divider',
        bgcolor: active ? theme.palette.brand.primarySoft : 'background.paper',
        color: active ? 'primary.main' : 'text.primary',
        boxShadow: active ? theme.palette.brand.elevation.glow : 'none',
        '&:disabled': { opacity: 0.55 },
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      {icon}
      <Typography variant="caption">{label}</Typography>
      {hint}
    </ButtonBase>
  );
}

/**
 * Scene button — same tile language, semantically a scene selector.
 *
 * `pressed` не прокидывается намеренно: сцена НИКОГДА не показывается
 * «включённой». Подтверждать у неё нечего — тега F_Scene_* на объекте не
 * существует (прозвон §8.3).
 */
export function SceneButton({ pressed: _ignored, ...props }: RoomTileButtonProps) {
  return <ActionButton {...props} testId={props.testId ?? 'room-scene'} />;
}

/* ── Running / offline indicators ─────────────────────────────────────────── */

export interface RoomStatusProps {
  label: string;
  testId?: string;
}

/** In-progress indicator — a spinning marker while a command is applied. */
export function RunningIndicator({ label, testId = 'room-running' }: RoomStatusProps) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" data-testid={testId} sx={{ color: 'primary.main' }}>
      <Box
        aria-hidden
        sx={{
          display: 'flex',
          '@keyframes kitSpin': { to: { transform: 'rotate(360deg)' } },
          animation: 'kitSpin 1s linear infinite',
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        <IconRunning size={18} />
      </Box>
      <Typography variant="caption">{label}</Typography>
    </Stack>
  );
}

/** No-connection indicator — a muted marker when a device is unreachable. */
export function OfflineIndicator({ label, testId = 'room-offline' }: RoomStatusProps) {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      data-testid={testId}
      sx={{ color: 'brand.textTertiary' }}
    >
      <IconOffline size={18} />
      <Typography variant="caption">{label}</Typography>
    </Stack>
  );
}
