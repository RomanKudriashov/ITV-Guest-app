import { useEffect, useRef } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';

import { behaviourFor } from '@/offerings/behaviour';
import { ProductOrderForm } from './ProductOrderForm';
import { RequestOrderForm } from './RequestOrderForm';
import { errorMessage } from '../errors';
import { useGuestItem } from '../hooks/useGuestQueries';
import type { ItemDetail, MenuItem } from '../api/types';

export interface ItemSheetProps {
  itemId: string | null;
  /** Row data from the catalog — renders the sheet instantly while details load. */
  listItem?: MenuItem | null;
  onClose: () => void;
}

/**
 * The item card as a bottom sheet — ONE sheet for every offering type.
 *
 * The shell (drawer, close button, loading and error states, headline) is shared;
 * what the guest fills in below the headline is chosen by the behaviour registry:
 * a dish gets modifiers, a quantity and "add to cart", a service gets a form of
 * request fields and "send". There is no second sheet and no second flow.
 */
export function ItemSheet({ itemId, listItem, onClose }: ItemSheetProps) {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  const seedDetail =
    listItem && listItem.modifier_groups
      ? ({ ...listItem, modifier_groups: listItem.modifier_groups } as ItemDetail)
      : undefined;

  const { data, isLoading, error } = useGuestItem(itemId, seedDetail);
  const item = data ?? (listItem ? ({ ...listItem, modifier_groups: [] } as ItemDetail) : null);

  // `has_fields` is a property of the item; the registry answers for the type
  // when a leaner list payload does not carry the flag.
  const usesFields = item ? (item.has_fields ?? behaviourFor(item.type).usesFields) : false;

  // Move focus into the sheet so screen readers announce the item, not the page.
  useEffect(() => {
    if (!itemId) return;
    const handle = window.setTimeout(() => titleRef.current?.focus(), 120);
    return () => window.clearTimeout(handle);
  }, [itemId]);

  return (
    <Drawer
      anchor="bottom"
      open={Boolean(itemId)}
      onClose={onClose}
      keepMounted={false}
      PaperProps={{
        sx: {
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          maxHeight: '92dvh',
        },
      }}
    >
      <Box
        data-testid="guest-item-sheet"
        role="dialog"
        aria-modal
        aria-label={item?.title ?? t('guest.item.title')}
        sx={{ display: 'flex', flexDirection: 'column', maxHeight: '92dvh' }}
      >
        <Box
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            display: 'flex',
            justifyContent: 'flex-end',
            p: 1,
            bgcolor: 'background.paper',
          }}
        >
          <IconButton
            onClick={onClose}
            aria-label={t('guest.common.close')}
            data-testid="guest-item-sheet-close"
            sx={{ minWidth: 44, minHeight: 44 }}
          >
            <CloseIcon />
          </IconButton>
        </Box>

        {!item ? (
          <Box sx={{ px: 2, pb: 3 }}>
            {isLoading ? (
              <Stack alignItems="center" sx={{ py: 6 }}>
                <CircularProgress aria-label={t('guest.common.loading')} />
              </Stack>
            ) : error ? (
              <Alert severity="error">{errorMessage(error, t)}</Alert>
            ) : null}
          </Box>
        ) : usesFields ? (
          <RequestOrderForm item={item} titleRef={titleRef} onClose={onClose} />
        ) : (
          <ProductOrderForm
            item={item}
            detailLoaded={Boolean(data)}
            titleRef={titleRef}
            onClose={onClose}
          />
        )}
      </Box>
    </Drawer>
  );
}
