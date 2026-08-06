import Box from '@mui/material/Box';
import type { ReactNode } from 'react';

import { useItemSheetLayout } from './itemSheetLayout';
import { itemCard } from '../storefrontTokens';

/**
 * Layout slots of the item sheet. Both bodies (a dish and a request form) live
 * inside the very same scroll area and the very same sticky footer — the sheet
 * itself does not know which one it is showing.
 */

export function SheetScroll({ children }: { children: ReactNode }) {
  const { mediaBeside } = useItemSheetLayout();
  return (
    <Box
      sx={{
        overflowY: 'auto',
        px: 2,
        pb: 2,
        flexGrow: 1,
        /*
          Место под кнопку закрытия — ТОЛЬКО когда кадр стоит сбоку.

          На телефоне крестик лежит поверх фотографии, и отступ сверху оторвал
          бы кадр от края карточки. На десктопе кадра над содержимым нет, и
          кнопка оказывалась ровно на названии позиции: заголовок начинался в
          той же строке, где висит крестик.
        */
        pt: mediaBeside ? itemCard.closeClearance : 0,
      }}
    >
      {children}
    </Box>
  );
}

export function SheetFooter({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        /*
          ЛИПКИЙ НИЗ, а не «конец прокрутки».

          На телефоне карточка — шторка, и футер там всегда был на виду просто
          потому, что тело её не переполняло. На десктопе прокручивается сама
          колонка содержимого, и кнопка «Добавить» уезжала за нижний край
          модалки: гость видел поле комментария и ни одного действия. Липкость
          решает это одинаково в обоих случаях, а `bottom: 0` внутри
          прокручиваемого контейнера — ровно то место, где кнопка и нужна.
        */
        position: 'sticky',
        bottom: 0,
        zIndex: 2,
        p: 2,
        pb: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      {children}
    </Box>
  );
}
