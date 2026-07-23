import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { AppIconComponent } from '@/icons';
import { KitImage } from '@/kit';
import type { ItemDetail, MenuBadge } from '../api/types';
import { FlagChips, NutritionInline } from './ItemMeta';
import { ItemBadges, PrepMinutesChip } from './ItemBadges';

export interface CatalogRowViewProps {
  testId: string;
  title: string;
  description?: string;
  imageSrc?: string | null;
  /** Icon on the designed fallback when the row has no photo. */
  fallbackIcon?: AppIconComponent;
  flags: string[];
  /** Marketing badges — shown as small filled chips over the media. */
  badges?: MenuBadge[];
  /** Prep-time chip ("~{n} мин") — shown only when the item carries it. */
  prepMinutes?: number | null;
  /** КБЖУ line — shown only when the item carries nutrition data. */
  nutrition?: ItemDetail['nutrition'];
  /** Already-formatted price, or `null` to hide it (an unpriced service). */
  priceLabel: string | null;
  unavailableNote?: string | null;
  available: boolean;
  onOpen?: () => void;
  /** Trailing action (add button, stepper …) — supplied by the cart-aware caller. */
  action?: ReactNode;
}

/**
 * The presentational body of one catalog card (the `.card` block): a
 * photo on top that dissolves nowhere — a fixed 146px image — then the body with
 * title, a two-line description, the КБЖУ line, flag chips and a row that carries
 * the price and the on-card action button. Unavailable cards dim to `.card.off`.
 *
 * It owns no cart or session state, so the storefront (`CatalogPage`) and the CMS
 * brand preview render identical cards from it — the markup lives here once.
 */
export function CatalogRowView({
  testId,
  title,
  description,
  imageSrc,
  fallbackIcon,
  flags,
  badges,
  prepMinutes,
  nutrition,
  priceLabel,
  unavailableNote,
  available,
  onOpen,
  action,
}: CatalogRowViewProps) {
  return (
    <Box
      data-testid={testId}
      sx={(theme) => ({
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: '16px',
        overflow: 'hidden',
        opacity: available ? 1 : 0.5,
        transition: 'transform .22s cubic-bezier(.2,.7,.2,1), box-shadow .22s',
        '&:hover': available
          ? { transform: 'translateY(-4px)', boxShadow: theme.palette.brand.elevation.lg }
          : undefined,
        '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
      })}
    >
      {/* Photo — the whole media + headline opens the sheet. */}
      <ButtonBase
        onClick={onOpen}
        disabled={!available}
        aria-label={title}
        sx={{ display: 'block', textAlign: 'start', width: '100%' }}
      >
        <Box sx={{ position: 'relative', height: 146 }}>
          <KitImage src={imageSrc} alt={title} fill fallbackIcon={fallbackIcon} fallbackIconSize={44} />
          {badges?.length ? (
            <Box sx={{ position: 'absolute', top: 8, insetInlineStart: 8, maxWidth: 'calc(100% - 16px)' }}>
              <ItemBadges badges={badges} size="sm" />
            </Box>
          ) : null}
        </Box>
        <Box sx={{ px: '14px', pt: '13px' }}>
          <Typography
            variant="subtitle2"
            sx={(theme) => ({
              fontFamily: theme.typography.h1.fontFamily,
              fontWeight: 800,
              fontSize: '0.9375rem',
              letterSpacing: '-0.01em',
              lineHeight: 1.25,
            })}
          >
            {title}
          </Typography>
          {description ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                mt: 0.5,
                fontSize: '0.75rem',
                lineHeight: 1.4,
                minHeight: 32,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {description}
            </Typography>
          ) : null}
        </Box>
      </ButtonBase>

      {/* Body — nutrition, flags, then the price / action row pinned to the bottom. */}
      <Box sx={{ px: '14px', pb: '14px', pt: description ? 1 : '13px', display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
        {nutrition ? (
          <Box sx={{ mb: 1 }}>
            <NutritionInline nutrition={nutrition} />
          </Box>
        ) : null}
        {flags.length || prepMinutes != null ? (
          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" alignItems="center" sx={{ mb: 1.25 }}>
            <PrepMinutesChip minutes={prepMinutes} />
            <FlagChips flags={flags} />
          </Stack>
        ) : null}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1.25}
          sx={{ mt: 'auto', minHeight: 40 }}
        >
          {/* "No price" is a normal state for a service — never print "0 ₽". */}
          <Stack spacing={0} sx={{ minWidth: 0 }}>
            {priceLabel ? (
              <Typography
                sx={(theme) => ({
                  fontFamily: theme.typography.h1.fontFamily,
                  fontWeight: 800,
                  fontSize: '1.1875rem',
                  letterSpacing: '-0.02em',
                })}
              >
                {priceLabel}
              </Typography>
            ) : null}
            {unavailableNote ? (
              <Typography variant="caption" color="text.secondary">
                {unavailableNote}
              </Typography>
            ) : null}
          </Stack>
          {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
        </Stack>
      </Box>
    </Box>
  );
}
