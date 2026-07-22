import type { ReactNode } from 'react';
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
  current: number;
  target: number;
  unit?: string;
  min?: number;
  max?: number;
  label?: string;
  size?: number;
  testId?: string;
}

export function Thermostat({
  current,
  target,
  unit = '°',
  min = 16,
  max = 30,
  label,
  size = 148,
  testId = 'room-thermostat',
}: ThermostatProps) {
  const theme = useTheme();
  const pct = Math.max(0, Math.min(1, (target - min) / (max - min)));
  const r = 52;
  const circ = 2 * Math.PI * r;
  // Draw a 270° gauge (three quarters) for the target.
  const gauge = 0.75;
  return (
    <Stack spacing={1} alignItems="center" data-testid={testId}>
      <Box sx={{ position: 'relative', width: size, height: size }}>
        <Box
          component="svg"
          viewBox="0 0 120 120"
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
            {Math.round(current)}
            {unit}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {Math.round(target)}
            {unit}
          </Typography>
        </Stack>
      </Box>
      {label ? <ControlLabel>{label}</ControlLabel> : null}
    </Stack>
  );
}

/* ── Large toggle switch ──────────────────────────────────────────────────── */

export interface LargeToggleProps {
  on: boolean;
  onChange?: (next: boolean) => void;
  label?: string;
  ariaLabel?: string;
  testId?: string;
}

export function LargeToggle({ on, onChange, label, ariaLabel, testId = 'room-toggle' }: LargeToggleProps) {
  return (
    <Stack spacing={1} alignItems="center" data-testid={testId}>
      <ButtonBase
        role="switch"
        aria-checked={on}
        aria-label={ariaLabel ?? label}
        onClick={() => onChange?.(!on)}
        sx={(theme) => ({
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
  onClick?: () => void;
  testId?: string;
}

/** Generic pressable tile — used for an action whose state isn't readable. */
export function ActionButton({ icon, label, active = false, onClick, testId = 'room-action' }: RoomTileButtonProps) {
  return (
    <ButtonBase
      onClick={onClick}
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
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      {icon}
      <Typography variant="caption">{label}</Typography>
    </ButtonBase>
  );
}

/** Scene button — same tile language, semantically a scene selector. */
export function SceneButton(props: RoomTileButtonProps) {
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
