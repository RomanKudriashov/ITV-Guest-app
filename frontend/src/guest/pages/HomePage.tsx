import { useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/EmptyState';
import {
  CarouselItem,
  KitImage,
  MosaicTile,
  PricePill,
  RoomTag,
  SkeletonCard,
  mediaFallbackSx,
  revealSx,
} from '@/kit';
import { IconBack } from '@/icons';
import { errorMessage } from '../errors';
import { fallbackIconFor } from '../components/typeFallbackIcon';
import { useGuestCatalog, useGuestHome } from '../hooks/useGuestQueries';
import { useMoney } from '../hooks/useMoney';
import { useGuestSession } from '../session/GuestSessionProvider';
import type { MenuItem } from '../api/types';

/**
 * Home screen for EVERY hotel, whatever it offers. The sections come from
 * `GET /api/guest/home`, already filtered to the types the hotel actually fills
 * and ordered by the server; the storefront only draws what it receives. Nothing
 * about the layout is food-specific.
 *
 * Photo-first: a full-width hero whose bottom dissolves into the page so the feed
 * overlaps it as one canvas, an offers carousel (a slice of the catalog), and a
 * varied-size mosaic of the server's sections.
 */
export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const { session, hotel } = useGuestSession();
  const { data, isLoading, error, refetch } = useGuestHome();
  // Offers are a slice of the product catalog for now (photo cards on the rail).
  const catalog = useGuestCatalog('product');
  const { formatOptional } = useMoney();

  const sections = data?.sections ?? [];
  const room = data?.room ?? session?.room ?? null;
  const hotelName = data?.hotel?.name ?? hotel?.name ?? '';

  const offers = useMemo<MenuItem[]>(() => {
    const items: MenuItem[] = [];
    for (const category of catalog.data?.categories ?? []) {
      for (const item of category.items) {
        if (item.is_available) items.push(item);
      }
    }
    return items.slice(0, 10);
  }, [catalog.data]);

  const heroImage = offers.find((item) => item.images?.[0])?.images?.[0] ?? null;

  const railRef = useRef<HTMLDivElement | null>(null);
  const scrollRail = (dir: 1 | -1) => {
    const node = railRef.current;
    if (!node) return;
    const sign = theme.direction === 'rtl' ? -dir : dir;
    node.scrollBy({ left: sign * Math.min(node.clientWidth * 0.8, 480), behavior: 'smooth' });
  };

  return (
    <Box data-testid="guest-home">
      {/* ── Hero: full-width cover that dissolves into the page background ── */}
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          height: { xs: 300, sm: 360, md: 460 },
          overflow: 'hidden',
        }}
      >
        {heroImage ? (
          <KitImage src={heroImage} alt={hotelName} fill fallbackIconSize={72} />
        ) : (
          <Box aria-hidden sx={(th) => ({ position: 'absolute', inset: 0, ...mediaFallbackSx(th) })} />
        )}
        {/* Two scrims: a dark band keeps text legible; the last sliver melts into
            the page background so the feed reads as one canvas with the hero. */}
        <Box
          aria-hidden
          sx={(th) => ({
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(to top, ${th.palette.brand.scrim} 18%, ${th.palette.brand.scrim} 46%, transparent 78%)`,
          })}
        />
        <Box
          aria-hidden
          sx={(th) => ({
            position: 'absolute',
            insetInline: 0,
            bottom: 0,
            height: '30%',
            background: `linear-gradient(to top, ${th.palette.background.default}, transparent)`,
          })}
        />
        <Container
          maxWidth="lg"
          sx={{ position: 'absolute', insetInline: 0, bottom: 0, pb: { xs: 7, md: 11 } }}
        >
          <Stack
            direction="row"
            alignItems="flex-end"
            justifyContent="space-between"
            spacing={2}
            sx={revealSx()}
          >
            <Stack spacing={0.5} sx={{ minWidth: 0 }}>
              <Typography
                variant="h2"
                component="h1"
                sx={(th) => ({
                  color: 'common.white',
                  lineHeight: 1.1,
                  textShadow: `0 2px 12px ${th.palette.brand.scrim}`,
                })}
              >
                {t('guest.home.greeting')}
              </Typography>
              <Typography variant="body1" sx={{ color: 'common.white', opacity: 0.92 }}>
                {room
                  ? t('guest.home.roomLine', { room, hotel: hotelName })
                  : t('guest.home.noRoomLine')}
              </Typography>
            </Stack>
            {room ? <RoomTag label={t('guest.common.roomShort', { room: '' }).trim()} room={room} size="md" /> : null}
          </Stack>
        </Container>
      </Box>

      {/* Feed overlaps the dissolved hero — one canvas, not banner-then-list. */}
      <Container
        maxWidth="lg"
        sx={{ position: 'relative', zIndex: 1, mt: { xs: -3, md: -5 }, pb: { xs: 5, md: 8 } }}
      >
        {isLoading ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, 1fr)' },
              gap: 2,
            }}
          >
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
        ) : !sections.length ? (
          <EmptyState
            title={t('guest.home.emptyTitle')}
            description={t('guest.home.emptyHint')}
            testId="guest-home-empty"
          />
        ) : (
          <Stack spacing={{ xs: 4, md: 6 }}>
            {/* ── Offers carousel ─────────────────────────────────────────── */}
            {offers.length ? (
              <Stack spacing={1.5}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="h5" component="h2">
                    {t('guest.home.offers')}
                  </Typography>
                  {isDesktop ? (
                    <Stack direction="row" spacing={1}>
                      <IconButton
                        aria-label={t('guest.home.prev')}
                        onClick={() => scrollRail(-1)}
                        sx={{ border: 1, borderColor: 'divider', width: 44, height: 44 }}
                      >
                        <IconBack size={20} />
                      </IconButton>
                      <IconButton
                        aria-label={t('guest.home.next')}
                        onClick={() => scrollRail(1)}
                        sx={{ border: 1, borderColor: 'divider', width: 44, height: 44 }}
                      >
                        <Box sx={{ display: 'flex', transform: 'scaleX(-1)' }}>
                          <IconBack size={20} />
                        </Box>
                      </IconButton>
                    </Stack>
                  ) : null}
                </Stack>
                <Box
                  ref={railRef}
                  sx={{
                    display: 'flex',
                    gap: 2,
                    overflowX: 'auto',
                    scrollSnapType: 'x mandatory',
                    pb: 1,
                    mx: -1,
                    px: 1,
                    scrollbarWidth: 'none',
                    '&::-webkit-scrollbar': { display: 'none' },
                  }}
                >
                  {offers.map((item, i) => {
                    const price = formatOptional(item.price);
                    return (
                      <Box key={item.id} sx={{ scrollSnapAlign: 'start', ...revealSx({ index: i }) }}>
                        <CarouselItem
                          title={item.title}
                          imageSrc={item.images?.[0]}
                          fallbackIcon={fallbackIconFor(item.type)}
                          width={isDesktop ? 220 : 172}
                          onClick={() => navigate(`/menu?item=${item.id}`)}
                          caption={price ? <PricePill price={price} /> : undefined}
                        />
                      </Box>
                    );
                  })}
                </Box>
              </Stack>
            ) : null}

            {/* ── Mosaic of the server's sections (varied tile sizes) ─────── */}
            <Stack spacing={1.5}>
              <Typography variant="h5" component="h2">
                {t('guest.home.sectionsTitle')}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
                  gridAutoRows: { xs: 128, md: 168 },
                  gap: { xs: 1.5, md: 2 },
                }}
              >
                {sections.map((section, i) => {
                  // Give the first section a hero-sized tile so the mosaic varies.
                  const big = i === 0;
                  return (
                    <MosaicTile
                      key={section.code}
                      testId={`guest-home-section-${section.type}`}
                      title={section.title}
                      fallbackIcon={fallbackIconFor(section.type)}
                      span={big ? 2 : 1}
                      rowSpan={big ? 2 : 1}
                      revealIndex={i}
                      onClick={() => navigate(section.route)}
                    />
                  );
                })}
              </Box>
            </Stack>
          </Stack>
        )}
      </Container>
    </Box>
  );
}
