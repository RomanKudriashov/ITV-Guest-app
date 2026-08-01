import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/EmptyState';
import { SkeletonCard } from '@/kit';
import { errorMessage } from '../errors';
import { ActiveOrderStrip } from '../components/ActiveOrderStrip';
import { BentoGrid } from '../components/Bento';
import { HomeHero } from '../components/HomeHero';
import { useGuestHome } from '../hooks/useGuestQueries';
import { useGuestSession } from '../session/GuestSessionProvider';

/**
 * Home is the SERVICE showcase for every hotel: a greeting, the live-order strip,
 * then a bento of the hotel's services (venues, service categories, info) built
 * server-side from data. It is no longer a food storefront — the dish carousel now
 * lives inside a restaurant, one level down.
 */
export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hotel } = useGuestSession();
  const { data, isLoading, error, refetch } = useGuestHome();

  // Bento columns by spec §4: 2 (phone) / 3 (tablet) / 4 (desktop).
  const isTablet = useMediaQuery('(min-width:768px)');
  const isDesktop = useMediaQuery('(min-width:1024px)');
  const columns = isDesktop ? 4 : isTablet ? 3 : 2;

  const tiles = data?.tiles ?? [];
  const hotelName = data?.hotel?.name ?? hotel?.name ?? '';

  return (
    <Box data-testid="guest-home">
      {/*
        Парадная во всю ширину — вне контейнера: кадр отеля обрезанный полями
        перестаёт быть парадной.
      */}
      {/*
        Номер комнаты рисует ШЕЛЛ, и только он: до этого чип был и в шапке
        героя, и в плавающей группе — на телефоне гость видел его дважды.
        У элемента должен быть один владелец.
      */}
      <HomeHero
        hotelName={hotelName}
        greeting={t('guest.home.greeting')}
        cover={hotel?.cover_image ?? null}
      />

      <Container maxWidth="lg" sx={{ pt: { xs: 2, md: 3 }, pb: { xs: 5, md: 8 } }}>
        <Stack spacing={{ xs: 2, md: 2.5 }} sx={{ mb: { xs: 3, md: 4 } }}>
          <ActiveOrderStrip />
        </Stack>

        {isLoading ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gridAutoRows: { xs: 128, md: 150 }, gap: { xs: 1.25, md: 1.75 } }}>
            {Array.from({ length: isDesktop ? 6 : 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </Box>
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
        ) : !tiles.length ? (
          <EmptyState
            title={t('guest.home.emptyTitle')}
            description={t('guest.home.emptyHint')}
            testId="guest-home-empty"
          />
        ) : (
          <BentoGrid tiles={tiles} columns={columns} onOpen={(route) => navigate(route)} />
        )}
      </Container>
    </Box>
  );
}
