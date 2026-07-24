import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppIconComponent } from '@/icons';
import { KitImage } from '@/kit';
import { AllergensBlock, CharacteristicsBlock, NutritionBlock } from './ItemMeta';
import { ItemBadges, PrepMinutesChip } from './ItemBadges';
import { fallbackIconFor } from './typeFallbackIcon';
import { useItemSheetLayout } from './itemSheetLayout';
import { useMoney } from '../hooks/useMoney';
import type { ItemDetail } from '../api/types';

/**
 * Item media — a capped-height cover photo (or the DESIGNED fallback) whose
 * bottom edge dissolves into the page background via a gradient scrim, so the
 * card reads as one canvas rather than "banner then text". `variant` adapts it:
 * `top` sits above the content (phone / stacked), `rail` fills a side column and
 * dissolves along its inline-end edge (desktop side-by-side).
 */
export function ItemMedia({
  item,
  variant = 'top',
  fallbackIcon,
}: {
  item: ItemDetail;
  variant?: 'top' | 'rail';
  fallbackIcon?: AppIconComponent;
}) {
  const icon = fallbackIcon ?? fallbackIconFor(item.type);
  const isRail = variant === 'rail';
  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        ...(isRail
          ? { width: { md: 320, lg: 380 }, alignSelf: 'stretch', minHeight: '100%' }
          : {
              width: '100%',
              // Capped so a tall image never pushes the body off-screen (the desktop bug).
              height: { xs: 200, sm: 240 },
              flexShrink: 0,
            }),
      }}
    >
      <KitImage src={item.images?.[0]} alt={item.title} fill fallbackIcon={icon} fallbackIconSize={isRail ? 64 : 48} />
      {/* Dissolve edge — the media melts into the content's background. */}
      <Box
        aria-hidden
        sx={(theme) => ({
          position: 'absolute',
          inset: 0,
          background: isRail
            ? `linear-gradient(${theme.direction === 'rtl' ? 'to left' : 'to right'}, transparent 60%, ${theme.palette.background.paper})`
            : `linear-gradient(to top, ${theme.palette.background.paper}, transparent 45%)`,
        })}
      />
    </Box>
  );
}

export interface ItemHeadlineViewProps {
  item: ItemDetail;
  /** Already-formatted price, or `null` to hide it (unpriced service). */
  priceLabel: string | null;
  /** Skip the media block — the sheet placed the photo in a side rail. */
  hideMedia?: boolean;
  /** Icon for the designed fallback when the item has no photo. */
  fallbackIcon?: AppIconComponent;
}

/**
 * The part of an item card that is identical for every offering type: picture,
 * title, price, description, flags, allergens, КБЖУ/состав and the "not available
 * now" note. Every block renders FROM DATA — nutrition appears only when the item
 * carries a `nutrition` object, never because of the offering type. Pure and
 * presentational (takes a formatted price, reads no session/query) so the
 * storefront sheet and the CMS brand preview render the same card body.
 */
export const ItemHeadlineView = forwardRef<HTMLHeadingElement, ItemHeadlineViewProps>(
  function ItemHeadlineView({ item, priceLabel, hideMedia = false, fallbackIcon }, titleRef) {
    const { t } = useTranslation();

    return (
      <Stack spacing={2}>
        {hideMedia ? null : <ItemMedia item={item} variant="top" fallbackIcon={fallbackIcon} />}

        <Stack spacing={1.5}>
          {item.badges?.length ? <ItemBadges badges={item.badges} /> : null}
          <Stack spacing={0.5}>
            {/* Reference `.cat` — the category name as an accent overline. */}
            {item.category_title ? (
              <Typography
                component="span"
                sx={{
                  color: 'primary.main',
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  lineHeight: 1,
                }}
              >
                {item.category_title}
              </Typography>
            ) : null}
            <Typography variant="h4" component="h2" ref={titleRef} tabIndex={-1}>
              {item.title}
            </Typography>
            {/* No price is a legitimate state for a service — never print "0 ₽". */}
            {priceLabel ? (
              <Typography
                variant="h6"
                sx={(theme) => ({ color: theme.palette.brand.primaryStrong, fontFamily: theme.typography.h1.fontFamily })}
              >
                {priceLabel}
              </Typography>
            ) : null}
          </Stack>
          {item.description ? (
            <Typography variant="body2" color="text.secondary">
              {item.description}
            </Typography>
          ) : null}
          {/* Desktop §3: КБЖУ+portion line, then characteristics, then allergens
              (amber «contains») and markers (green «suitable»). Prep-time chip
              stays. Flags no longer render here — markers/characteristics/badges
              replace them; the catalog list card keeps its flag chips. */}
          <NutritionBlock nutrition={item.nutrition} />
          <CharacteristicsBlock characteristics={item.characteristics} />
          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" alignItems="center">
            <PrepMinutesChip minutes={item.prep_minutes} />
          </Stack>
          <AllergensBlock allergens={item.allergens} markers={item.markers} />
        </Stack>

        {!item.is_available ? (
          <Alert severity="warning">
            {item.available_from
              ? t('guest.menu.availableFrom', { time: item.available_from })
              : t('guest.menu.unavailable')}
          </Alert>
        ) : null}
      </Stack>
    );
  },
);

/** Session-aware wrapper used by the storefront: formats the price, then delegates. */
export const ItemHeadline = forwardRef<HTMLHeadingElement, { item: ItemDetail }>(
  function ItemHeadline({ item }, titleRef) {
    const { formatOptional } = useMoney();
    const { mediaBeside, fallbackIcon } = useItemSheetLayout();
    return (
      <ItemHeadlineView
        ref={titleRef}
        item={item}
        priceLabel={formatOptional(item.price)}
        hideMedia={mediaBeside}
        fallbackIcon={fallbackIcon}
      />
    );
  },
);
