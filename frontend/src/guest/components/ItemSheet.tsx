import { useEffect, useMemo, useRef } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import CloseIcon from '@mui/icons-material/Close';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { MOTION, useSheetTransition } from '@/kit';
import { behaviourFor } from '@/offerings/behaviour';
import { InfoView } from './InfoView';
import { ItemMedia } from './ItemHeadline';
import { ProductOrderForm } from './ProductOrderForm';
import { RequestOrderForm } from './RequestOrderForm';
import { SlotBookingForm } from './SlotBookingForm';
import { ItemSheetLayoutContext } from './itemSheetLayout';
import { fallbackIconFor } from './typeFallbackIcon';
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
 * The item card as a sheet — ONE sheet for every offering type.
 *
 * The shell (drawer, close button, loading and error states, headline) is shared;
 * what the guest fills in below the headline is chosen by the behaviour registry:
 * a dish gets modifiers, a quantity and "add to cart", a service gets a form of
 * request fields and "send". There is no second sheet and no second flow.
 *
 * The layout is adaptive: a phone gets a bottom sheet with the photo on top
 * dissolving into the body; a desktop gets a floating panel with the photo in a
 * side rail beside the scrolling content (branch on the viewport, never the type).
 */
export function ItemSheet({ itemId, listItem, onClose }: ItemSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const transition = useSheetTransition();
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  const seedDetail =
    listItem && listItem.modifier_groups
      ? ({ ...listItem, modifier_groups: listItem.modifier_groups } as ItemDetail)
      : undefined;

  const { data, isLoading, error } = useGuestItem(itemId, seedDetail);
  const item = data ?? (listItem ? ({ ...listItem, modifier_groups: [] } as ItemDetail) : null);

  // The registry chooses the body. `has_fields` is a property carried by the
  // item, so it wins when present; everything else is a flag of the type. The
  // sheet itself stays ignorant of which body it renders.
  const behaviour = item ? behaviourFor(item.type) : null;
  const usesFields = item ? (item.has_fields ?? behaviour!.usesFields) : false;
  const fallbackIcon = fallbackIconFor(item?.type);

  const layout = useMemo(
    () => ({ mediaBeside: isDesktop, fallbackIcon }),
    [isDesktop, fallbackIcon],
  );

  // Move focus into the sheet so screen readers announce the item, not the page.
  useEffect(() => {
    if (!itemId) return;
    const handle = window.setTimeout(() => titleRef.current?.focus(), 120);
    return () => window.clearTimeout(handle);
  }, [itemId]);

  const body = !item ? (
    <Box sx={{ px: 2, pb: 3 }}>
      {isLoading ? (
        <Stack alignItems="center" sx={{ py: 6 }}>
          <CircularProgress aria-label={t('guest.common.loading')} />
        </Stack>
      ) : error ? (
        <Alert severity="error">{errorMessage(error, t)}</Alert>
      ) : null}
    </Box>
  ) : behaviour?.usesContent ? (
    <InfoView item={item} titleRef={titleRef} />
  ) : behaviour?.usesSlots ? (
    <SlotBookingForm item={item} titleRef={titleRef} onClose={onClose} />
  ) : usesFields ? (
    <RequestOrderForm item={item} titleRef={titleRef} onClose={onClose} />
  ) : (
    <ProductOrderForm item={item} detailLoaded={Boolean(data)} titleRef={titleRef} onClose={onClose} />
  );

  return (
    <Drawer
      anchor="bottom"
      open={Boolean(itemId)}
      onClose={onClose}
      keepMounted={false}
      transitionDuration={transition}
      SlideProps={{ easing: { enter: MOTION.easing.sheet, exit: MOTION.easing.sheet } }}
      PaperProps={{
        sx: (t) => ({
          borderTopLeftRadius: t.palette.brand.radius.lg,
          borderTopRightRadius: t.palette.brand.radius.lg,
          ...(isDesktop
            ? {
                // Floating centered panel on desktop — not a full-width banner.
                borderRadius: `${t.palette.brand.radius.lg}px`,
                width: 'min(940px, 94vw)',
                marginInline: 'auto',
                insetInline: 0,
                bottom: 24,
                maxHeight: '88vh',
                boxShadow: t.palette.brand.elevation.lg,
                overflow: 'hidden',
              }
            : { maxHeight: '92dvh' }),
        }),
      }}
    >
      <ItemSheetLayoutContext.Provider value={layout}>
        <Box
          data-testid="guest-item-sheet"
          role="dialog"
          aria-modal
          aria-label={item?.title ?? t('guest.item.title')}
          sx={{
            display: 'flex',
            flexDirection: isDesktop ? 'row' : 'column',
            minHeight: 0,
            maxHeight: isDesktop ? '88vh' : '92dvh',
          }}
        >
          {isDesktop && item ? <ItemMedia item={item} variant="rail" fallbackIcon={fallbackIcon} /> : null}

          <Box
            sx={{
              position: 'relative',
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <Box
              sx={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                display: 'flex',
                justifyContent: 'flex-end',
                p: 1,
                // Transparent on desktop so the media/content read as one canvas;
                // opaque on phone where it pins over scrolling content.
                bgcolor: isDesktop ? 'transparent' : 'background.paper',
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

            {body}
          </Box>
        </Box>
      </ItemSheetLayoutContext.Provider>
    </Drawer>
  );
}
