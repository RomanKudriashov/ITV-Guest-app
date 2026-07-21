import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';
import CleaningServicesOutlinedIcon from '@mui/icons-material/CleaningServicesOutlined';
import LocalLaundryServiceOutlinedIcon from '@mui/icons-material/LocalLaundryServiceOutlined';
import SpaOutlinedIcon from '@mui/icons-material/SpaOutlined';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useGuestSession } from '../session/GuestSessionProvider';

interface ServiceTile {
  code: string;
  icon: ReactNode;
  to?: string;
}

const TILES: ServiceTile[] = [
  { code: 'restaurant', icon: <RestaurantMenuIcon fontSize="large" />, to: '/menu' },
  { code: 'housekeeping', icon: <CleaningServicesOutlinedIcon fontSize="large" /> },
  { code: 'laundry', icon: <LocalLaundryServiceOutlinedIcon fontSize="large" /> },
  { code: 'spa', icon: <SpaOutlinedIcon fontSize="large" /> },
  { code: 'maintenance', icon: <BuildOutlinedIcon fontSize="large" /> },
  { code: 'concierge', icon: <SupportAgentOutlinedIcon fontSize="large" /> },
];

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session, hotel } = useGuestSession();

  return (
    <Container maxWidth="sm" sx={{ py: 3 }} data-testid="guest-home">
      <Stack spacing={3}>
        <Stack spacing={0.5}>
          <Typography variant="h5" component="h1">
            {t('guest.home.greeting')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {session?.room
              ? t('guest.home.roomLine', { room: session.room, hotel: hotel?.name ?? '' })
              : t('guest.home.noRoomLine')}
          </Typography>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 1.5,
          }}
        >
          {TILES.map((tile) => {
            const enabled = Boolean(tile.to);
            return (
              <ButtonBase
                key={tile.code}
                disabled={!enabled}
                onClick={() => tile.to && navigate(tile.to)}
                data-testid={`guest-service-${tile.code}`}
                aria-label={t(`guest.services.${tile.code}`)}
                sx={{
                  minHeight: 116,
                  p: 2,
                  borderRadius: 3,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: enabled ? 'background.paper' : 'brand.surfaceMuted',
                  opacity: enabled ? 1 : 0.6,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  textAlign: 'start',
                  color: enabled ? 'primary.main' : 'text.secondary',
                }}
              >
                {tile.icon}
                <Stack spacing={0.5} sx={{ width: '100%' }}>
                  <Typography variant="subtitle2" color="text.primary">
                    {t(`guest.services.${tile.code}`)}
                  </Typography>
                  {!enabled ? (
                    <Chip
                      size="small"
                      label={t('guest.home.soon')}
                      sx={{ alignSelf: 'flex-start', height: 20, fontSize: '0.68rem' }}
                    />
                  ) : null}
                </Stack>
              </ButtonBase>
            );
          })}
        </Box>
      </Stack>
    </Container>
  );
}
