import type { ReactNode } from 'react';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';

export interface GuestBrandHeaderProps {
  hotelName: string;
  /** Brand logo for the current mode; the hotel name is shown when absent. */
  logoSrc?: string;
  /** Controls (language, theme, room chip) rendered at the trailing edge. */
  rightSlot?: ReactNode;
  position?: 'sticky' | 'static';
}

/**
 * The storefront's brand header — logo (or hotel name) plus a trailing slot.
 * Pure and presentational so the same markup serves the live guest layout and
 * the CMS brand preview; it reads no session, cart or query.
 */
export function GuestBrandHeader({
  hotelName,
  logoSrc,
  rightSlot,
  position = 'sticky',
}: GuestBrandHeaderProps) {
  return (
    <AppBar
      position={position}
      color="default"
      elevation={0}
      sx={{
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        pt: 'env(safe-area-inset-top, 0px)',
      }}
    >
      <Toolbar sx={{ gap: 1, minHeight: 56 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
          {logoSrc ? (
            <Box
              component="img"
              src={logoSrc}
              alt={hotelName}
              data-testid="guest-brand-logo"
              sx={{ height: 32, maxWidth: 200, objectFit: 'contain' }}
            />
          ) : (
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
              {hotelName}
            </Typography>
          )}
        </Box>
        {rightSlot}
      </Toolbar>
    </AppBar>
  );
}
