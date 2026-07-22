import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';

import {
  IconClose,
  IconCheck,
  IconInfo,
  IconStatusCancelled,
  type AppIconComponent,
} from '@/icons';

/* ── Sheet / Drawer ───────────────────────────────────────────────────────── */

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Pinned footer (action bar). */
  footer?: ReactNode;
  closeLabel?: string;
  testId?: string;
}

/** Bottom sheet with a grabber, title row and optional pinned footer. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel = 'Close',
  testId = 'sheet',
}: SheetProps) {
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      data-testid={testId}
      PaperProps={{
        sx: (theme: Theme) => ({
          borderTopLeftRadius: theme.palette.brand.radius.lg,
          borderTopRightRadius: theme.palette.brand.radius.lg,
          maxHeight: '90vh',
        }),
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1 }}>
        <Box
          aria-hidden
          sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'divider' }}
        />
      </Box>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2, pt: 1, pb: 0.5 }}
      >
        {title ? (
          <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
            {title}
          </Typography>
        ) : (
          <Box sx={{ flexGrow: 1 }} />
        )}
        <IconButton aria-label={closeLabel} onClick={onClose} data-testid={`${testId}-close`}>
          <IconClose size={20} />
        </IconButton>
      </Stack>
      <Box sx={{ px: 2, pb: 2, overflowY: 'auto' }}>{children}</Box>
      {footer ? (
        <Box sx={{ borderTop: 1, borderColor: 'divider' }}>{footer}</Box>
      ) : null}
    </Drawer>
  );
}

/* ── Toast (presentational) ───────────────────────────────────────────────── */

export type ToastSeverity = 'success' | 'info' | 'warning' | 'error';

const TOAST_META: Record<ToastSeverity, { Icon: AppIconComponent; color: (t: Theme) => string }> = {
  success: { Icon: IconCheck, color: (t) => t.palette.success.main },
  info: { Icon: IconInfo, color: (t) => t.palette.info.main },
  warning: { Icon: IconInfo, color: (t) => t.palette.warning.main },
  error: { Icon: IconStatusCancelled, color: (t) => t.palette.error.main },
};

export interface KitToastProps {
  severity: ToastSeverity;
  message: string;
  action?: ReactNode;
  testId?: string;
}

export function KitToast({ severity, message, action, testId }: KitToastProps) {
  const meta = TOAST_META[severity];
  const { Icon } = meta;
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      data-testid={testId ?? `toast-${severity}`}
      sx={(theme) => ({
        px: 2,
        py: 1.5,
        borderRadius: `${theme.palette.brand.radius.md}px`,
        bgcolor: 'background.paper',
        color: 'text.primary',
        boxShadow: theme.palette.brand.elevation.lg,
        borderInlineStart: `4px solid ${meta.color(theme)}`,
        minWidth: 260,
      })}
    >
      <Box sx={(theme) => ({ color: meta.color(theme), display: 'flex' })}>
        <Icon size={20} />
      </Box>
      <Typography variant="body2" sx={{ flexGrow: 1 }}>
        {message}
      </Typography>
      {action}
    </Stack>
  );
}

/* ── Empty state ──────────────────────────────────────────────────────────── */

export interface KitEmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  testId?: string;
}

export function KitEmptyState({
  icon,
  title,
  description,
  action,
  testId = 'empty-state',
}: KitEmptyStateProps) {
  return (
    <Stack
      spacing={1.5}
      alignItems="center"
      data-testid={testId}
      sx={{ textAlign: 'center', py: 5, px: 3 }}
    >
      {icon ? (
        <Box
          sx={(theme) => ({
            display: 'grid',
            placeItems: 'center',
            width: 64,
            height: 64,
            borderRadius: '50%',
            bgcolor: theme.palette.brand.primarySoft,
            color: 'primary.main',
          })}
        >
          {icon}
        </Box>
      ) : null}
      <Typography variant="h6" component="p">
        {title}
      </Typography>
      {description ? (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320 }}>
          {description}
        </Typography>
      ) : null}
      {action}
    </Stack>
  );
}

/* ── Skeletons ────────────────────────────────────────────────────────────── */

const skeletonSx = (theme: Theme) => ({
  bgcolor: theme.palette.brand.surfaceMuted,
  borderRadius: `${theme.palette.brand.radius.sm}px`,
  '@keyframes kitPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.5 } },
  animation: 'kitPulse 1.4s ease-in-out infinite',
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
});

/** A single shimmer bar. */
export function SkeletonLine({ width = '100%', height = 12 }: { width?: number | string; height?: number }) {
  return <Box aria-hidden sx={(theme) => ({ ...skeletonSx(theme), width, height })} />;
}

/** A row skeleton (thumbnail + two lines) matching OrderLineRow / CatalogRow. */
export function SkeletonRow({ testId = 'skeleton-row' }: { testId?: string }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" data-testid={testId} sx={{ py: 1.25 }}>
      <Box aria-hidden sx={(theme) => ({ ...skeletonSx(theme), width: 48, height: 48, borderRadius: 2 })} />
      <Stack spacing={1} sx={{ flexGrow: 1 }}>
        <SkeletonLine width="60%" />
        <SkeletonLine width="40%" height={10} />
      </Stack>
    </Stack>
  );
}

/** A card skeleton (image block + caption). */
export function SkeletonCard({ testId = 'skeleton-card' }: { testId?: string }) {
  return (
    <Stack spacing={1.25} data-testid={testId}>
      <Box aria-hidden sx={(theme) => ({ ...skeletonSx(theme), width: '100%', height: 120, borderRadius: `${theme.palette.brand.radius.lg}px` })} />
      <SkeletonLine width="70%" />
      <SkeletonLine width="45%" height={10} />
    </Stack>
  );
}
