import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { IconRestaurant } from '@/icons';

/** Shared photo layer: image when present, else a token placeholder + icon. */
function PhotoLayer({ src, alt }: { src?: string | null; alt: string }) {
  if (src) {
    return (
      <Box
        component="img"
        src={src}
        alt={alt}
        loading="lazy"
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
    );
  }
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'brand.surfaceMuted',
        color: 'brand.textTertiary',
      }}
    >
      <IconRestaurant size={40} />
    </Box>
  );
}

/* ── PhotoCard (hero: image + scrim + overlaid caption) ───────────────────── */

export interface PhotoCardProps {
  title: string;
  subtitle?: string;
  imageSrc?: string | null;
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
      sx={(theme) => ({
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
      })}
    >
      <PhotoLayer src={imageSrc} alt={title} />
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
  onClick?: () => void;
  /** Grid span in columns (for a masonry-style mosaic). */
  span?: number;
  testId?: string;
}

export function MosaicTile({
  title,
  imageSrc,
  icon,
  onClick,
  span = 1,
  testId = 'mosaic-tile',
}: MosaicTileProps) {
  return (
    <ButtonBase
      onClick={onClick}
      focusRipple
      data-testid={testId}
      sx={(theme) => ({
        position: 'relative',
        gridColumn: `span ${span}`,
        minHeight: 132,
        borderRadius: `${theme.palette.brand.radius.lg}px`,
        overflow: 'hidden',
        textAlign: 'start',
        boxShadow: theme.palette.brand.elevation.sm,
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      <PhotoLayer src={imageSrc} alt={title} />
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
  caption?: ReactNode;
  onClick?: () => void;
  width?: number;
  testId?: string;
}

export function CarouselItem({
  title,
  imageSrc,
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
      sx={(theme) => ({
        flex: '0 0 auto',
        width,
        display: 'block',
        textAlign: 'start',
        borderRadius: `${theme.palette.brand.radius.lg}px`,
        overflow: 'hidden',
        bgcolor: 'background.paper',
        boxShadow: theme.palette.brand.elevation.sm,
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      <Box sx={{ position: 'relative', height: 112 }}>
        <PhotoLayer src={imageSrc} alt={title} />
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
  note?: string;
  action?: ReactNode;
  testId?: string;
}

export function OrderLineRow({
  title,
  qty,
  price,
  imageSrc,
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
        <PhotoLayer src={imageSrc} alt={title} />
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
