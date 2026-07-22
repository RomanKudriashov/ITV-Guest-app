import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { AppIconComponent } from '@/icons';
import { KitImage } from './KitImage';
import { pressableSx, revealSx } from './motion';

/**
 * Shared photo layer: lazy image with a skeleton when present, else a DESIGNED
 * fallback (a monochrome icon on a textured token surface) — never a flat circle.
 */
function PhotoLayer({
  src,
  alt,
  fallbackIcon,
  fallbackIconSize,
}: {
  src?: string | null;
  alt: string;
  fallbackIcon?: AppIconComponent;
  fallbackIconSize?: number;
}) {
  return (
    <KitImage src={src} alt={alt} fill fallbackIcon={fallbackIcon} fallbackIconSize={fallbackIconSize} />
  );
}

/* ── PhotoCard (hero: image + scrim + overlaid caption) ───────────────────── */

export interface PhotoCardProps {
  title: string;
  subtitle?: string;
  imageSrc?: string | null;
  /** Icon drawn on the designed fallback when there is no image. */
  fallbackIcon?: AppIconComponent;
  /** Overlaid top-start slot — badges, price pill, etc. */
  overlay?: ReactNode;
  onClick?: () => void;
  height?: number;
  testId?: string;
}

export function PhotoCard({
  title,
  subtitle,
  imageSrc,
  fallbackIcon,
  overlay,
  onClick,
  height = 200,
  testId = 'photo-card',
}: PhotoCardProps) {
  return (
    <ButtonBase
      onClick={onClick}
      focusRipple
      data-testid={testId}
      sx={[
        (theme) => ({
          display: 'block',
          position: 'relative',
          width: '100%',
          height,
          borderRadius: `${theme.palette.brand.radius.lg}px`,
          overflow: 'hidden',
          textAlign: 'start',
          boxShadow: theme.palette.brand.elevation.md,
          '&.Mui-focusVisible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
        }),
        pressableSx,
      ]}
    >
      <PhotoLayer src={imageSrc} alt={title} fallbackIcon={fallbackIcon} />
      {/* Scrim so the caption always reads over any photo. */}
      <Box
        aria-hidden
        sx={(theme) => ({
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(to top, ${theme.palette.brand.scrim} 8%, transparent 60%)`,
        })}
      />
      {overlay ? (
        <Box sx={{ position: 'absolute', top: 12, insetInlineStart: 12 }}>{overlay}</Box>
      ) : null}
      <Stack sx={{ position: 'absolute', insetInline: 0, bottom: 0, p: 2 }} spacing={0.25}>
        <Typography
          variant="h5"
          component="span"
          sx={(theme) => ({
            color: 'common.white',
            textShadow: `0 1px 8px ${theme.palette.brand.scrim}`,
          })}
        >
          {title}
        </Typography>
        {subtitle ? (
          <Typography
            variant="body2"
            component="span"
            sx={{ color: 'common.white', opacity: 0.85 }}
          >
            {subtitle}
          </Typography>
        ) : null}
      </Stack>
    </ButtonBase>
  );
}

/* ── MosaicTile (large square-ish tile with corner label) ─────────────────── */

export interface MosaicTileProps {
  title: string;
  imageSrc?: string | null;
  icon?: ReactNode;
  /** Icon drawn on the designed fallback when there is no image. */
  fallbackIcon?: AppIconComponent;
  onClick?: () => void;
  /** Grid span in columns (for a masonry-style mosaic). */
  span?: number;
  /** Grid span in rows (for a masonry-style mosaic). */
  rowSpan?: number;
  /** Minimum tile height (px) — lets a mosaic vary tile sizes. */
  minHeight?: number;
  /** Position in the mosaic — drives a staggered mount reveal. */
  revealIndex?: number;
  testId?: string;
}

export function MosaicTile({
  title,
  imageSrc,
  icon,
  fallbackIcon,
  onClick,
  span = 1,
  rowSpan = 1,
  minHeight = 132,
  revealIndex,
  testId = 'mosaic-tile',
}: MosaicTileProps) {
  return (
    <ButtonBase
      onClick={onClick}
      focusRipple
      data-testid={testId}
      aria-label={title}
      sx={[
        (theme) => ({
          position: 'relative',
          gridColumn: `span ${span}`,
          gridRow: `span ${rowSpan}`,
          minHeight,
          height: '100%',
          borderRadius: `${theme.palette.brand.radius.lg}px`,
          overflow: 'hidden',
          textAlign: 'start',
          boxShadow: theme.palette.brand.elevation.md,
          '&.Mui-focusVisible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
        }),
        pressableSx,
        revealIndex != null ? revealSx({ index: revealIndex }) : {},
      ]}
    >
      <PhotoLayer src={imageSrc} alt={title} fallbackIcon={fallbackIcon} fallbackIconSize={44} />
      <Box
        aria-hidden
        sx={(theme) => ({
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(135deg, transparent 40%, ${theme.palette.brand.scrim})`,
        })}
      />
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ position: 'absolute', insetInline: 0, bottom: 0, p: 1.5, color: 'common.white' }}
      >
        {icon}
        <Typography variant="subtitle1" component="span">
          {title}
        </Typography>
      </Stack>
    </ButtonBase>
  );
}

/* ── CarouselItem (fixed-width card for a horizontal rail) ────────────────── */

export interface CarouselItemProps {
  title: string;
  imageSrc?: string | null;
  /** Icon drawn on the designed fallback when there is no image. */
  fallbackIcon?: AppIconComponent;
  caption?: ReactNode;
  onClick?: () => void;
  width?: number;
  testId?: string;
}

export function CarouselItem({
  title,
  imageSrc,
  fallbackIcon,
  caption,
  onClick,
  width = 168,
  testId = 'carousel-item',
}: CarouselItemProps) {
  return (
    <ButtonBase
      onClick={onClick}
      focusRipple
      data-testid={testId}
      aria-label={title}
      sx={[
        (theme) => ({
          flex: '0 0 auto',
          width,
          display: 'block',
          textAlign: 'start',
          borderRadius: `${theme.palette.brand.radius.lg}px`,
          overflow: 'hidden',
          bgcolor: 'background.paper',
          boxShadow: theme.palette.brand.elevation.md,
          '&.Mui-focusVisible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
        }),
        pressableSx,
      ]}
    >
      <Box sx={{ position: 'relative', height: 112 }}>
        <PhotoLayer src={imageSrc} alt={title} fallbackIcon={fallbackIcon} />
      </Box>
      <Stack spacing={0.25} sx={{ p: 1.25 }}>
        <Typography variant="subtitle2" noWrap>
          {title}
        </Typography>
        {caption}
      </Stack>
    </ButtonBase>
  );
}

/* ── OrderLineRow (a line in a cart / order) ──────────────────────────────── */

export interface OrderLineRowProps {
  title: string;
  qty: number;
  price: string;
  imageSrc?: string | null;
  /** Icon drawn on the designed fallback when there is no image. */
  fallbackIcon?: AppIconComponent;
  note?: string;
  action?: ReactNode;
  testId?: string;
}

export function OrderLineRow({
  title,
  qty,
  price,
  imageSrc,
  fallbackIcon,
  note,
  action,
  testId = 'order-line-row',
}: OrderLineRowProps) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      data-testid={testId}
      sx={{ py: 1.25 }}
    >
      <Box
        sx={{
          position: 'relative',
          width: 48,
          height: 48,
          flexShrink: 0,
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <PhotoLayer src={imageSrc} alt={title} fallbackIcon={fallbackIcon} fallbackIconSize={22} />
      </Box>
      <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" noWrap>
          {title}
        </Typography>
        {note ? (
          <Typography variant="caption" color="text.secondary" noWrap>
            {note}
          </Typography>
        ) : null}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        ×{qty}
      </Typography>
      <Typography
        variant="subtitle2"
        sx={{ minWidth: 64, textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}
      >
        {price}
      </Typography>
      {action}
    </Stack>
  );
}
