import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button, { type ButtonProps } from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';

import { IconAdd, IconMinus } from '@/icons';

/**
 * The reference `.cta` — the sheet's / cart's primary action: an accent gradient
 * (bright accent → base accent) with the accent glow. Colours come from tokens
 * only (`primaryStrong` → `primary`). Compose into a contained Button's `sx`.
 */
export const ctaGradientSx = (theme: Theme) => ({
  background: `linear-gradient(120deg, ${theme.palette.brand.primaryStrong}, ${theme.palette.primary.main})`,
  color: theme.palette.primary.contrastText,
  boxShadow: theme.palette.brand.elevation.glow,
  borderRadius: `${theme.palette.brand.radius.md}px`,
  '&:hover': {
    background: `linear-gradient(120deg, ${theme.palette.brand.primaryStrong}, ${theme.palette.primary.main})`,
    boxShadow: theme.palette.brand.elevation.glow,
  },
  '&.Mui-disabled': {
    background: theme.palette.action.disabledBackground,
    color: theme.palette.action.disabled,
    boxShadow: 'none',
  },
});

/* ── KitButton ────────────────────────────────────────────────────────────── */

export type KitButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface KitButtonProps extends Omit<ButtonProps, 'variant' | 'color'> {
  kitVariant?: KitButtonVariant;
  loading?: boolean;
}

const VARIANT_PROPS: Record<KitButtonVariant, Pick<ButtonProps, 'variant' | 'color'>> = {
  primary: { variant: 'contained', color: 'primary' },
  secondary: { variant: 'outlined', color: 'primary' },
  ghost: { variant: 'text', color: 'primary' },
  danger: { variant: 'contained', color: 'error' },
};

/**
 * The kit button. Covers every state — default / hover / active / disabled /
 * loading — across the four variants. Enforces a ≥44px touch target and a
 * visible `:focus-visible` ring; the accent glow marks the primary action.
 */
export function KitButton({
  kitVariant = 'primary',
  loading = false,
  disabled,
  children,
  startIcon,
  sx,
  ...rest
}: KitButtonProps) {
  const mui = VARIANT_PROPS[kitVariant];
  return (
    <Button
      {...mui}
      {...rest}
      disabled={disabled || loading}
      startIcon={loading ? undefined : startIcon}
      sx={[
        (theme) => ({
          minHeight: 44,
          borderRadius: `${theme.palette.brand.radius.md}px`,
          fontWeight: theme.typography.fontWeightMedium,
          boxShadow: kitVariant === 'primary' ? theme.palette.brand.elevation.glow : 'none',
          '&:active': { transform: 'translateY(1px)' },
          '&.Mui-focusVisible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
          '@media (prefers-reduced-motion: reduce)': {
            transition: 'none',
            '&:active': { transform: 'none' },
          },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {loading ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} color="inherit" />
          <span>{children}</span>
        </Stack>
      ) : (
        children
      )}
    </Button>
  );
}

/* ── QuantityStepper ──────────────────────────────────────────────────────── */

export interface QuantityStepperProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  decreaseLabel?: string;
  increaseLabel?: string;
  testId?: string;
}

export function QuantityStepper({
  value,
  min = 0,
  max = 99,
  onChange,
  decreaseLabel = 'Decrease',
  increaseLabel = 'Increase',
  testId = 'quantity-stepper',
}: QuantityStepperProps) {
  const btn = (theme: import('@mui/material/styles').Theme) => ({
    width: 44,
    height: 44,
    color: 'primary.main',
    '&.Mui-focusVisible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 2,
    },
  });
  return (
    <Stack
      direction="row"
      alignItems="center"
      data-testid={testId}
      sx={(theme) => ({
        borderRadius: `${theme.palette.brand.radius.pill}px`,
        border: 1,
        borderColor: 'divider',
        bgcolor: theme.palette.brand.surfaceMuted,
      })}
    >
      <IconButton
        aria-label={decreaseLabel}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        data-testid={`${testId}-minus`}
        sx={btn}
      >
        <IconMinus size={18} />
      </IconButton>
      <Typography
        component="span"
        data-testid={`${testId}-value`}
        sx={{ minWidth: 24, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
      <IconButton
        aria-label={increaseLabel}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        data-testid={`${testId}-plus`}
        sx={btn}
      >
        <IconAdd size={18} />
      </IconButton>
    </Stack>
  );
}

/* ── StickyActionBar ──────────────────────────────────────────────────────── */

export interface StickyActionBarProps {
  children: ReactNode;
  testId?: string;
}

/** Bottom-pinned action bar with a top hairline and safe-area padding. */
export function StickyActionBar({ children, testId = 'sticky-action-bar' }: StickyActionBarProps) {
  return (
    <Box
      data-testid={testId}
      sx={(theme) => ({
        position: 'sticky',
        bottom: 0,
        zIndex: 2,
        p: 2,
        pb: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        bgcolor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
        boxShadow: theme.palette.brand.elevation.lg,
      })}
    >
      {children}
    </Box>
  );
}
