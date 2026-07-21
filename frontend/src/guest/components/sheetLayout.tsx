import Box from '@mui/material/Box';
import type { ReactNode } from 'react';

/**
 * Layout slots of the item sheet. Both bodies (a dish and a request form) live
 * inside the very same scroll area and the very same sticky footer — the sheet
 * itself does not know which one it is showing.
 */

export function SheetScroll({ children }: { children: ReactNode }) {
  return <Box sx={{ overflowY: 'auto', px: 2, pb: 2, flexGrow: 1 }}>{children}</Box>;
}

export function SheetFooter({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
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
