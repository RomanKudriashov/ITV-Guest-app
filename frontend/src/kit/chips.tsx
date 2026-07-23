import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
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

/* ── ChipOption (selectable chip-button — reference `.opt` / `.opt.sel`) ────── */

export interface ChipOptionProps {
  /** Primary label (reference `.opt .t`). */
  label: string;
  /** Secondary line — a price delta such as "+150 ₽" (reference `.opt .p`). */
  hint?: string;
  selected?: boolean;
  onToggle?: () => void;
  /** ARIA semantics: single-select group → radio, multi-select → checkbox. */
  role?: 'radio' | 'checkbox';
  disabled?: boolean;
  testId?: string;
}

/**
 * A tap-to-select chip-button — the redesign's modifier / choice control. NOT a
 * radio dot or a checkbox: the whole pill fills with a soft accent wash and an
 * accent border when selected (reference `.opt.sel`). Keeps a ≥44px target and a
 * visible focus ring, and announces itself as a radio/checkbox to assistive tech.
 */
export function ChipOption({
  label,
  hint,
  selected = false,
  onToggle,
  role = 'checkbox',
  disabled = false,
  testId,
}: ChipOptionProps) {
  return (
    <ButtonBase
      onClick={onToggle}
      disabled={disabled}
      focusRipple
      role={role}
      aria-checked={selected}
      data-testid={testId}
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 0.25,
        minWidth: 92,
        minHeight: 44,
        px: 1.75,
        py: 1.25,
        borderRadius: `${theme.palette.brand.radius.md}px`,
        border: `1.5px solid ${selected ? theme.palette.primary.main : theme.palette.divider}`,
        bgcolor: selected ? theme.palette.brand.primarySoft : theme.palette.brand.surfaceMuted,
        color: 'text.primary',
        textAlign: 'start',
        transition: 'border-color .16s, background-color .16s, transform .12s',
        '&:hover': { borderColor: theme.palette.primary.main },
        '&:active': { transform: 'scale(.97)' },
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
          '&:active': { transform: 'none' },
        },
      })}
    >
      <Typography component="span" variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
        {label}
      </Typography>
      {hint ? (
        <Typography
          component="span"
          variant="caption"
          sx={{
            color: selected ? 'primary.main' : 'text.secondary',
            fontWeight: selected ? 700 : 400,
            lineHeight: 1.2,
          }}
        >
          {hint}
        </Typography>
      ) : null}
    </ButtonBase>
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

/* ── Status color token → palette ─────────────────────────────────────────── */

/**
 * Maps a backend `status.color_token` (`info`/`warning`/`success`/`danger`…) to a
 * theme palette color — the single place a status token becomes a color, so the
 * order strip and any future status surface stay token-only, light and dark.
 */
export function statusTokenColor(token: string | undefined, theme: Theme): string {
  switch (token) {
    case 'success':
      return theme.palette.success.main;
    case 'warning':
      return theme.palette.warning.main;
    case 'danger':
    case 'error':
      return theme.palette.error.main;
    case 'info':
      return theme.palette.info.main;
    case 'primary':
      return theme.palette.primary.main;
    case 'secondary':
      return theme.palette.secondary.main;
    default:
      return theme.palette.text.secondary;
  }
}

/* ── Badge color role → palette ───────────────────────────────────────────── */

/** The four marketing-badge palette roles (mirror of backend `color_role`). */
export const BADGE_COLOR_ROLES = ['accent', 'gold', 'success', 'info'] as const;
export type BadgeColorRoleName = (typeof BADGE_COLOR_ROLES)[number];

/**
 * Maps a marketing badge `color_role` to a theme palette color — the single
 * place a badge role becomes a color, so every badge surface (CMS editor,
 * assignment control, future storefront) stays token-only, light and dark.
 * `gold` reuses the warning token, the same "gold" signal the kit's Хит badge
 * already uses.
 */
export function badgeRoleColor(role: string | undefined, theme: Theme): string {
  switch (role) {
    case 'accent':
      return theme.palette.primary.main;
    case 'gold':
      return theme.palette.warning.main;
    case 'success':
      return theme.palette.success.main;
    case 'info':
      return theme.palette.info.main;
    default:
      return theme.palette.primary.main;
  }
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
