import { useMemo } from 'react';
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
import LocalTaxiOutlinedIcon from '@mui/icons-material/LocalTaxiOutlined';
import RoomServiceOutlinedIcon from '@mui/icons-material/RoomServiceOutlined';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useGuestCatalog } from '../hooks/useGuestQueries';
import { useGuestSession } from '../session/GuestSessionProvider';

interface Tile {
  /** Testid suffix: `guest-service-<code>`. */
  code: string;
  label: string;
  icon: ReactNode;
  to?: string;
}

/**
 * Icons are matched by the item/category code where we know one, so a hotel that
 * names its service "taxi" gets a taxi glyph without any per-hotel config. An
 * unknown code simply gets the neutral room-service icon.
 */
const ICONS: Record<string, ReactNode> = {
  restaurant: <RestaurantMenuIcon fontSize="large" />,
  housekeeping: <CleaningServicesOutlinedIcon fontSize="large" />,
  cleaning: <CleaningServicesOutlinedIcon fontSize="large" />,
  laundry: <LocalLaundryServiceOutlinedIcon fontSize="large" />,
  spa: <SpaOutlinedIcon fontSize="large" />,
  maintenance: <BuildOutlinedIcon fontSize="large" />,
  concierge: <SupportAgentOutlinedIcon fontSize="large" />,
  taxi: <LocalTaxiOutlinedIcon fontSize="large" />,
};

/** Placeholders shown until the hotel actually publishes its services. */
const PLACEHOLDER_CODES = ['housekeeping', 'laundry', 'spa', 'maintenance', 'concierge'];

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session, hotel } = useGuestSession();

  // The same catalog endpoint as the services screen — the home tiles are just
  // its shortest presentation, not a separate source of truth.
  const servicesQuery = useGuestCatalog('service_request');

  const tiles = useMemo<Tile[]>(() => {
    const services = (servicesQuery.data?.categories ?? []).flatMap(
      (category) => category.items,
    );

    const serviceTiles: Tile[] = services.map((item) => ({
      code: item.code,
      label: item.title,
      icon: ICONS[item.code] ?? <RoomServiceOutlinedIcon fontSize="large" />,
      // Straight to the request form of that service — the catalog screen and
      // the sheet are the same ones the menu uses.
      to: `/services?item=${item.id}`,
    }));

    const placeholders: Tile[] = serviceTiles.length
      ? []
      : PLACEHOLDER_CODES.map((code) => ({
          code,
          label: t(`guest.services.${code}`),
          icon: ICONS[code],
        }));

    return [
      {
        code: 'restaurant',
        label: t('guest.services.restaurant'),
        icon: ICONS.restaurant,
        to: '/menu',
      },
      ...serviceTiles,
      ...placeholders,
    ];
  }, [servicesQuery.data, t]);

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
          {tiles.map((tile) => {
            const enabled = Boolean(tile.to);
            return (
              <ButtonBase
                key={tile.code}
                disabled={!enabled}
                onClick={() => tile.to && navigate(tile.to)}
                data-testid={`guest-service-${tile.code}`}
                aria-label={tile.label}
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
                    {tile.label}
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
