import { createContext, useContext } from 'react';

import type { AppIconComponent } from '@/icons';

/**
 * Layout contract between the item sheet and the headline it renders.
 *
 * The four form bodies (product / request / slot / info) all render `ItemHeadline`
 * without knowing where the sheet placed the media. On desktop the sheet lifts the
 * photo into a side rail (`mediaBeside`), so the headline must NOT draw it again;
 * on a phone the headline keeps the photo on top. Passed by context so no form has
 * to thread the flag through.
 */
export interface ItemSheetLayout {
  /** True when the sheet renders the media in a side rail (desktop). */
  mediaBeside: boolean;
  /** Icon for the designed fallback when the item has no photo. */
  fallbackIcon?: AppIconComponent;
}

export const ItemSheetLayoutContext = createContext<ItemSheetLayout>({ mediaBeside: false });

export function useItemSheetLayout(): ItemSheetLayout {
  return useContext(ItemSheetLayoutContext);
}
