import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';
import RoomServiceOutlinedIcon from '@mui/icons-material/RoomServiceOutlined';
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/EmptyState';
import type { OfferingType } from '@/offerings/behaviour';
import { errorMessage } from '../errors';
import { useGuestHome } from '../hooks/useGuestQueries';
import { useGuestSession } from '../session/GuestSessionProvider';

/**
 * Home icon per offering TYPE — a lookup, not a chain of `if (type === …)`. The
 * route a tile navigates to is never guessed here: it comes straight from the
 * section payload (`section.route`), so a new type is a new server section and a
 * new row in this map, nothing more.
 */
const SECTION_ICON: Record<OfferingType, ReactNode> = {
  product: <RestaurantMenuIcon fontSize="large" />,
  service_request: <RoomServiceOutlinedIcon fontSize="large" />,
  slot: <EventAvailableOutlinedIcon fontSize="large" />,
  info: <InfoOutlinedIcon fontSize="large" />,
};

/**
 * Home screen for EVERY hotel, whatever it offers. The sections come from
 * `GET /api/guest/home`, already filtered to the types the hotel actually fills
 * and ordered by the server; the storefront only draws what it receives. Nothing
 * about the layout is food-specific.
 */
export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session, hotel } = useGuestSession();
  const { data, isLoading, error, refetch } = useGuestHome();

  const sections = data?.sections ?? [];
  const room = data?.room ?? session?.room ?? null;
  const hotelName = data?.hotel?.name ?? hotel?.name ?? '';

  return (
    <Container maxWidth="sm" sx={{ py: 3 }} data-testid="guest-home">
      <Stack spacing={3}>
        <Stack spacing={0.5}>
          <Typography variant="h5" component="h1">
            {t('guest.home.greeting')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {room
              ? t('guest.home.roomLine', { room, hotel: hotelName })
              : t('guest.home.noRoomLine')}
          </Typography>
        </Stack>

        {isLoading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress aria-label={t('guest.common.loading')} />
          </Stack>
        ) : error ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => void refetch()}>
                {t('guest.common.retry')}
              </Button>
            }
          >
            {errorMessage(error, t)}
          </Alert>
        ) : !sections.length ? (
          <EmptyState
            title={t('guest.home.emptyTitle')}
            description={t('guest.home.emptyHint')}
            testId="guest-home-empty"
          />
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 1.5,
            }}
          >
            {sections.map((section) => (
              <ButtonBase
                key={section.code}
                onClick={() => navigate(section.route)}
                data-testid={`guest-home-section-${section.type}`}
                aria-label={section.title}
                sx={{
                  minHeight: 116,
                  p: 2,
                  borderRadius: 3,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  textAlign: 'start',
                  color: 'primary.main',
                }}
              >
                {SECTION_ICON[section.type] ?? <RoomServiceOutlinedIcon fontSize="large" />}
                <Typography variant="subtitle2" color="text.primary" sx={{ width: '100%' }}>
                  {section.title}
                </Typography>
              </ButtonBase>
            ))}
          </Box>
        )}
      </Stack>
    </Container>
  );
}
