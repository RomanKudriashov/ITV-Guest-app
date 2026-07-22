import { type Ref } from 'react';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ItemHeadline } from './ItemHeadline';
import { InfoContent } from './InfoContent';
import { SheetScroll } from './sheetLayout';
import type { ItemDetail } from '../api/types';

export interface InfoViewProps {
  item: ItemDetail;
  titleRef: Ref<HTMLHeadingElement>;
}

/**
 * Body of the sheet for an `info` offering — a page the guest only READS.
 *
 * There is no footer and no order button: `behaviour.createsOrder` is false, so
 * this type never touches the cart, the checkout or the tracker. It reuses the
 * same headline (picture + title) as every other card and renders `content`
 * below it; nothing else about the sheet changes.
 */
export function InfoView({ item, titleRef }: InfoViewProps) {
  const { t } = useTranslation();
  const content = item.content?.trim();

  return (
    <SheetScroll>
      <Stack spacing={2} data-testid="guest-info-view">
        <ItemHeadline item={item} ref={titleRef} />
        {content ? (
          <InfoContent content={content} testId="guest-info-content" />
        ) : (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="guest-info-content"
          >
            {t('guest.info.empty')}
          </Typography>
        )}
      </Stack>
    </SheetScroll>
  );
}
