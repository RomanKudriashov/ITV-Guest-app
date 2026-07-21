import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { FlagChips, ItemThumb } from './ItemMeta';

export interface CatalogRowViewProps {
  testId: string;
  title: string;
  description?: string;
  imageSrc?: string | null;
  flags: string[];
  /** Already-formatted price, or `null` to hide it (an unpriced service). */
  priceLabel: string | null;
  unavailableNote?: string | null;
  available: boolean;
  onOpen?: () => void;
  /** Trailing action (add button, stepper …) — supplied by the cart-aware caller. */
  action?: ReactNode;
}

/**
 * The presentational body of one catalog row: photo, title, description, flags,
 * price and the "not available now" note. It owns no cart or session state, so
 * the storefront (`CatalogPage`) and the CMS brand preview render identical rows
 * from it — the markup lives here once.
 */
export function CatalogRowView({
  testId,
  title,
  description,
  imageSrc,
  flags,
  priceLabel,
  unavailableNote,
  available,
  onOpen,
  action,
}: CatalogRowViewProps) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      sx={{ py: 1.5, opacity: available ? 1 : 0.55 }}
      data-testid={testId}
    >
      <ButtonBase
        onClick={onOpen}
        disabled={!available}
        aria-label={title}
        sx={{
          flexGrow: 1,
          display: 'flex',
          gap: 1.5,
          alignItems: 'center',
          textAlign: 'start',
          minHeight: 44,
          borderRadius: 2,
        }}
      >
        <ItemThumb src={imageSrc} alt={title} dimmed={!available} />
        <Stack spacing={0.5} sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ lineHeight: 1.25 }}>
            {title}
          </Typography>
          {description ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {description}
            </Typography>
          ) : null}
          <FlagChips flags={flags} />
          <Stack direction="row" spacing={1} alignItems="center">
            {/* "No price" is a normal state for a service — never print "0 ₽". */}
            {priceLabel ? <Typography variant="subtitle2">{priceLabel}</Typography> : null}
            {unavailableNote ? (
              <Typography variant="caption" color="text.secondary">
                {unavailableNote}
              </Typography>
            ) : null}
          </Stack>
        </Stack>
      </ButtonBase>

      {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
    </Stack>
  );
}
