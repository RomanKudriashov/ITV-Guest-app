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
import { itemCard, storefrontTokens, surfaceRadius } from '../storefrontTokens';

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
  const { dialogBackdrop, glass } = useStorefront();
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
  const fallbackIcon = fallbackIconFor(item?.type, item?.service_type);

  // Кадр на ПК — сверху во всю ширину окна (партия 58б), а не колонкой сбоку.
  const layout = useMemo(
    () => ({ mediaBeside: false, mediaWide: isDesktop, fallbackIcon }),
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
  // on desktop with the photo across the top of the window.
  const closeButton = (
    <Box
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 3,
        display: 'flex',
        justifyContent: 'flex-end',
        /*
          ВЫСОТА НОЛЬ — и это главное здесь.

          Раньше это была настоящая полоса высотой в кнопку, да ещё и залитая
          цветом поверхности на телефоне: карточка открывалась белым бруском,
          фотография начиналась под ним, а крестик сидел на бруске, а не на
          кадре. Полоса ничего не держала — она существовала только чтобы
          где-то разместить кнопку.

          Нулевая высота с `overflow: visible` убирает брусок из потока:
          кадр начинается от самого верха карточки, а кнопка ложится поверх
          него. `sticky` при этом сохраняется — крестик остаётся на месте, пока
          содержимое прокручивается под ним.
        */
        height: 0,
        overflow: 'visible',
        // Сквозные клики: полоса нулевая, но она всё ещё перекрывает верх
        // кадра прямоугольником — без этого по фото нельзя было бы попасть.
        pointerEvents: 'none',
        '& > *': { pointerEvents: 'auto' },
      }}
    >
      {/*
        Закрытие — стеклянный чип, как в прототипе, а не голая иконка. Кнопка
        лежит поверх кадра позиции, и без подложки крестик пропадал на светлых
        снимках ровно там, где он нужен.
      */}
      <IconButton
        onClick={onClose}
        aria-label={t('guest.common.close')}
        data-testid="guest-item-sheet-close"
        sx={{ m: 1, minWidth: 44, minHeight: 44, ...glass.chip }}
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
            width: `min(${itemCard.wideWindow}px, 100%)`,
            maxWidth: `min(${itemCard.wideWindow}px, 100%)`,
            maxHeight: '88vh',
            m: 2,
            borderRadius: surfaceRadius.panel(t.palette.brand.radius),
            boxShadow: t.palette.brand.elevation.lg,
            overflow: 'hidden',
            /*
              БУМАГА ДИАЛОГА ПРОЗРАЧНА — иначе никакое стекло внутри не поможет:
              глухая поверхность закрывает витрину раньше, чем до неё дойдёт
              полупрозрачный слой. Плотность держит сама колонка, ниже.
            */
            backgroundColor: 'transparent',
            backgroundImage: 'none',
          }),
        }}
      >
        <ItemSheetLayoutContext.Provider value={layout}>
          {/*
            ОДНА КОЛОНКА: КАДР СВЕРХУ ВО ВСЮ ШИРИНУ ОКНА (партия 58б).

            Колонка 400 px слева резала кадр до 21 % («House rules») и тянула
            файл ×6: высота колонки росла с текстом, а ширина стояла. Теперь
            кадр над содержимым, форма — по самому фото в пределах 16:9…21:9
            (`ItemMedia` с `wide`), и всё окно — стекло `glass.sheet`, как
            шторка телефона.
          */}
          <Box
            data-testid="guest-item-sheet"
            role="dialog"
            aria-modal
            aria-label={item?.title ?? t('guest.item.title')}
            sx={(t) => ({
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              maxHeight: '88vh',
              ...storefrontTokens(t.palette.mode).glass.sheet,
            })}
          >
            {closeButton}
            {body}
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
          // Та же прозрачность, что у десктопной колонки: шторка на телефоне —
          // это та же панель, только снизу.
          backgroundColor: 'transparent',
          backgroundImage: 'none',
          ...storefrontTokens(t.palette.mode).glass.sheet,
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
