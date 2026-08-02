import { useEffect, useMemo, useRef } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import Drawer from '@mui/material/Drawer';
import Fade from '@mui/material/Fade';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import CloseIcon from '@mui/icons-material/Close';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTranslation } from 'react-i18next';

import { MOTION, useSheetTransition } from '@/kit';
import { behaviourFor } from '@/offerings/behaviour';
import { InfoView } from './InfoView';
import { ItemMedia } from './ItemHeadline';
import { ProductOrderForm } from './ProductOrderForm';
import { RequestOrderForm } from './RequestOrderForm';
import { SlotBookingForm } from './SlotBookingForm';
import { ItemSheetLayoutContext } from './itemSheetLayout';
import { useStorefront } from '../useStorefront';
import { fallbackIconFor } from './typeFallbackIcon';
import { errorMessage } from '../errors';
import { useGuestItem } from '../hooks/useGuestQueries';
import { DESKTOP_QUERY } from '../layout/constants';
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
  const { dialogBackdrop } = useStorefront();
  const { t } = useTranslation();
  // ≥1024 is the desktop shell (rail, no bottom nav) — the item card there is a
  // centered modal; below it (phone AND tablet) it stays a bottom sheet.
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
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

  // The close affordance and the chosen body are identical either way; only the
  // shell around them differs — a bottom sheet on phone/tablet, a centered modal
  // on desktop with the photo in a 400px side column.
  const closeButton = (
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
  );

  if (isDesktop) {
    return (
      <Dialog
        open={Boolean(itemId)}
        onClose={onClose}
        keepMounted={false}
        maxWidth={false}
        TransitionComponent={Fade}
        transitionDuration={transition}
        // Dim the catalog behind the modal (spec .stage .dim).
        slotProps={{ backdrop: { sx: { bgcolor: dialogBackdrop } } }}
        PaperProps={{
          sx: (t) => ({
            width: 'min(920px, 100%)',
            maxWidth: 'min(920px, 100%)',
            maxHeight: '88vh',
            m: 2,
            borderRadius: `${t.palette.brand.radius.lg}px`,
            boxShadow: t.palette.brand.elevation.lg,
            overflow: 'hidden',
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
              display: 'grid',
              // Photo left in a fixed 400px column, content right (spec .modal
              // 400px 1fr); grid keeps the two cells the same height, so the photo
              // always fills its side however tall the body grows. Single column
              // if the modal is squeezed narrow.
              gridTemplateColumns: { xs: '1fr', sm: '400px minmax(0, 1fr)' },
              maxHeight: '88vh',
            }}
          >
            {item ? (
              <Box sx={{ minHeight: { xs: 220, sm: 460 }, overflow: 'hidden' }}>
                <ItemMedia item={item} variant="rail" fallbackIcon={fallbackIcon} />
              </Box>
            ) : null}
            {/* The content cell scrolls on its own; the CTA sits at the end of it
                (spec .foot), the catalog behind stays dimmed. */}
            <Box sx={{ position: 'relative', minWidth: 0, minHeight: 0, maxHeight: '88vh', overflowY: 'auto' }}>
              {closeButton}
              {body}
            </Box>
          </Box>
        </ItemSheetLayoutContext.Provider>
      </Dialog>
    );
  }

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
          maxHeight: '92dvh',
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
            flexDirection: 'column',
            minHeight: 0,
            maxHeight: '92dvh',
          }}
        >
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
            {closeButton}
            {body}
          </Box>
        </Box>
      </ItemSheetLayoutContext.Provider>
    </Drawer>
  );
}
