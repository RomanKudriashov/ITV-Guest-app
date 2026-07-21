import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import { AllergenLine, FlagChips } from './ItemMeta';
import { useMoney } from '../hooks/useMoney';
import type { ItemDetail } from '../api/types';

export interface ItemHeadlineViewProps {
  item: ItemDetail;
  /** Already-formatted price, or `null` to hide it (unpriced service). */
  priceLabel: string | null;
}

/**
 * The part of an item card that is identical for every offering type: picture,
 * title, price, description, flags, allergens and the "not available now" note.
 * Pure and presentational (takes a formatted price, reads no session/query) so
 * the storefront sheet and the CMS brand preview render the same card body.
 */
export const ItemHeadlineView = forwardRef<HTMLHeadingElement, ItemHeadlineViewProps>(
  function ItemHeadlineView({ item, priceLabel }, titleRef) {
    const { t } = useTranslation();

    return (
      <Stack spacing={2}>
        {item.images?.[0] ? (
          <Box
            component="img"
            src={item.images[0]}
            alt={item.title}
            sx={{
              width: '100%',
              aspectRatio: '16 / 9',
              objectFit: 'cover',
              borderRadius: 3,
              bgcolor: 'brand.surfaceMuted',
            }}
          />
        ) : null}

        <Stack spacing={1}>
          <Typography variant="h5" component="h2" ref={titleRef} tabIndex={-1}>
            {item.title}
          </Typography>
          {/* No price is a legitimate state for a service — never print "0 ₽". */}
          {priceLabel ? (
            <Typography variant="h6" color="primary.main">
              {priceLabel}
            </Typography>
          ) : null}
          {item.description ? (
            <Typography variant="body2" color="text.secondary">
              {item.description}
            </Typography>
          ) : null}
          <FlagChips flags={item.flags ?? []} />
          <AllergenLine allergens={item.allergens ?? []} />
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
    return <ItemHeadlineView ref={titleRef} item={item} priceLabel={formatOptional(item.price)} />;
  },
);
