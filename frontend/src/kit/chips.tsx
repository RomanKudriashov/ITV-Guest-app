import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';

import { ICON_REGISTRY, IconHit, IconStatusNew, IconChefChoice } from '@/icons';
import type { AppIconComponent } from '@/icons';

/* ── Price pill ───────────────────────────────────────────────────────────── */

export interface PricePillProps {
  /** Already-formatted price label, e.g. "2 490 ₽". */
  price: string;
  emphasis?: boolean;
  testId?: string;
}

/** Accent numerals on a soft accent wash — the price reads as a bright signal. */
export function PricePill({ price, emphasis = false, testId = 'price-pill' }: PricePillProps) {
  return (
    <Box
      data-testid={testId}
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 28,
        px: 1.25,
        borderRadius: `${theme.palette.brand.radius.pill}px`,
        bgcolor: emphasis ? 'primary.main' : theme.palette.brand.primarySoft,
        color: emphasis ? 'primary.contrastText' : 'primary.main',
        boxShadow: emphasis ? theme.palette.brand.elevation.glow : 'none',
      })}
    >
      <Typography
        component="span"
        sx={(theme) => ({
          fontFamily: theme.typography.h1.fontFamily,
          fontWeight: theme.typography.fontWeightBold,
          fontSize: '0.95rem',
          lineHeight: 1,
        })}
      >
        {price}
      </Typography>
    </Box>
  );
}

/* ── Marketing badges (Хит / Новинка / Выбор шефа) ────────────────────────── */

export type KitBadgeKind = 'hit' | 'new' | 'chef';

const BADGE_META: Record<
  KitBadgeKind,
  { Icon: AppIconComponent; color: (t: Theme) => string; soft: (t: Theme) => string }
> = {
  hit: {
    Icon: IconHit,
    color: (t) => t.palette.warning.main,
    soft: (t) => t.palette.warning.main,
  },
  new: {
    Icon: IconStatusNew,
    color: (t) => t.palette.info.main,
    soft: (t) => t.palette.info.main,
  },
  chef: {
    Icon: IconChefChoice,
    color: (t) => t.palette.secondary.main,
    soft: (t) => t.palette.secondary.main,
  },
};

export interface KitBadgeProps {
  kind: KitBadgeKind;
  label: string;
  testId?: string;
}

/** Small solid badge with a leading icon — the "Хит / Новинка / Выбор шефа" tag. */
export function KitBadge({ kind, label, testId }: KitBadgeProps) {
  const meta = BADGE_META[kind];
  const { Icon } = meta;
  return (
    <Box
      data-testid={testId ?? `badge-${kind}`}
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.25,
        borderRadius: `${theme.palette.brand.radius.pill}px`,
        bgcolor: meta.color(theme),
        color: theme.palette.getContrastText(meta.color(theme)),
        fontSize: '0.72rem',
        fontWeight: theme.typography.fontWeightBold,
        lineHeight: 1.4,
      })}
    >
      <Icon size={14} />
      <span>{label}</span>
    </Box>
  );
}

/* ── Flag & allergen chips ────────────────────────────────────────────────── */

export interface FlagChipProps {
  /** Registry code (vegan, spicy, glutenFree, nuts, seafood, halal…). */
  code: string;
  label: string;
  /** `allergen` chips warn (warning tint); `flag` chips are neutral outlined. */
  tone?: 'flag' | 'allergen';
  testId?: string;
}

export function FlagChip({ code, label, tone = 'flag', testId }: FlagChipProps) {
  const Icon = ICON_REGISTRY[code];
  const allergen = tone === 'allergen';
  return (
    <Box
      data-testid={testId ?? `flag-chip-${code}`}
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.875,
        height: 24,
        borderRadius: `${theme.palette.brand.radius.pill}px`,
        border: 1,
        borderColor: allergen ? 'warning.main' : 'divider',
        color: allergen ? 'warning.main' : 'text.secondary',
        bgcolor: allergen ? 'transparent' : theme.palette.brand.surfaceMuted,
        fontSize: '0.72rem',
        lineHeight: 1,
      })}
    >
      {Icon ? <Icon size={14} /> : null}
      <span>{label}</span>
    </Box>
  );
}

/* ── Status indicator ─────────────────────────────────────────────────────── */

export type OrderStatusKind =
  | 'new'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'done'
  | 'cancelled';

const STATUS_META: Record<
  OrderStatusKind,
  { code: string; color: (t: Theme) => string }
> = {
  new: { code: 'statusNew', color: (t) => t.palette.info.main },
  accepted: { code: 'statusAccepted', color: (t) => t.palette.primary.main },
  preparing: { code: 'statusPreparing', color: (t) => t.palette.warning.main },
  ready: { code: 'statusReady', color: (t) => t.palette.success.main },
  done: { code: 'statusDone', color: (t) => t.palette.success.main },
  cancelled: { code: 'statusCancelled', color: (t) => t.palette.error.main },
};

export interface StatusIndicatorProps {
  status: OrderStatusKind;
  label: string;
  /** `dot` = compact dot + text; `pill` = soft filled pill with icon. */
  variant?: 'dot' | 'pill';
  testId?: string;
}

export function StatusIndicator({
  status,
  label,
  variant = 'pill',
  testId,
}: StatusIndicatorProps) {
  const meta = STATUS_META[status];
  const Icon = ICON_REGISTRY[meta.code];
  const content: ReactNode =
    variant === 'dot' ? (
      <Stack
        direction="row"
        spacing={0.75}
        alignItems="center"
        data-testid={testId ?? `status-${status}`}
      >
        <Box
          sx={(theme) => ({
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: meta.color(theme),
          })}
        />
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
      </Stack>
    ) : (
      <Box
        data-testid={testId ?? `status-${status}`}
        sx={(theme) => ({
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          height: 26,
          borderRadius: `${theme.palette.brand.radius.pill}px`,
          color: meta.color(theme),
          bgcolor: `color-mix(in srgb, ${meta.color(theme)} 16%, transparent)`,
          fontSize: '0.75rem',
          fontWeight: theme.typography.fontWeightMedium,
        })}
      >
        {Icon ? <Icon size={15} /> : null}
        <span>{label}</span>
      </Box>
    );
  return content;
}
