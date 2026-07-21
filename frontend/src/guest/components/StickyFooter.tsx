import type { ReactNode } from 'react';
import Box from '@mui/material/Box';

/**
 * Sticky bottom container for CTAs. Sits above the iOS home indicator via
 * `env(safe-area-inset-bottom)` and never covers content thanks to the spacer
 * the pages add below their scroll area.
 */
export function StickyFooter({
  children,
  offset = 0,
  testId,
}: {
  children: ReactNode;
  /** Extra bottom offset in px, e.g. to clear the bottom navigation. */
  offset?: number;
  testId?: string;
}) {
  return (
    <Box
      data-testid={testId}
      sx={{
        position: 'fixed',
        insetInline: 0,
        bottom: `calc(${offset}px + env(safe-area-inset-bottom, 0px))`,
        zIndex: (theme) => theme.zIndex.appBar,
        px: 2,
        pt: 1,
        pb: 1.5,
        bgcolor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
      }}
    >
      {children}
    </Box>
  );
}
