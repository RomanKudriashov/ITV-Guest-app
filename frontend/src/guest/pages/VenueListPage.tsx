import { useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/EmptyState';
import { KitImage, SkeletonCard } from '@/kit';
import { errorMessage } from '../errors';
import { tileCoverFallbackSx } from '../components/Bento';
import { useStorefront } from '../useStorefront';
import { fallbackIconFor } from '../components/typeFallbackIcon';
import { useGuestVenues } from '../hooks/useGuestQueries';
import type { GuestVenue } from '../api/types';
import { surfaceRadius } from '../storefrontTokens';
import { openingLabel } from '../nextOpening';

/**
 * Level 2 of the showcase: the venues of one group (restaurants / spa / services).
 * Photo cards with name, kind and open/closed status → the venue's own catalog.
 * Reached from a collapsed category tile when a hotel has more venues than the
 * grouping threshold.
 */
export function VenueListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { group = '' } = useParams<{ group: string }>();
  const { data, isLoading, error, refetch } = useGuestVenues(group);

  const venues = data?.venues ?? [];

  return (
    <Box data-testid="guest-venue-list">
      <Container maxWidth="lg" sx={{ pt: { xs: 3, md: 5 }, pb: { xs: 5, md: 8 } }}>
        <Typography
          component="h1"
          sx={(th) => ({
            fontFamily: th.typography.h1.fontFamily,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            fontSize: { xs: 24, md: 30 },
            mb: { xs: 2, md: 3 },
          })}
        >
          {data?.title ?? t(`guest.home.group.${group}`, { defaultValue: '' })}
        </Typography>

        {isLoading ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </Box>
        ) : error ? (
          <Alert severity="error" action={<button onClick={() => void refetch()}>{t('guest.common.retry')}</button>}>
            {errorMessage(error, t)}
          </Alert>
        ) : !venues.length ? (
          <EmptyState title={t('guest.venue.emptyTitle')} description={t('guest.venue.emptyHint')} testId="guest-venue-empty" />
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: { xs: 1.5, md: 2 } }}>
            {venues.map((venue) => (
              <VenueCard key={venue.code} venue={venue} onOpen={() => navigate(venue.route)} />
            ))}
          </Box>
        )}
      </Container>
    </Box>
  );
}

function VenueCard({ venue, onOpen }: { venue: GuestVenue; onOpen: () => void }) {
  const { tile, onMedia } = useStorefront();
  const { t } = useTranslation();
  const status = venue.status;
  const statusText = status
    ? status.state === 'open'
      ? status.until
        ? t('guest.venue.until', { time: status.until })
        : t('guest.venue.open')
      : (openingLabel(status, t) ?? t('guest.venue.closed'))
    : null;

  return (
    <ButtonBase
      focusRipple
      onClick={onOpen}
      data-testid={`guest-venue-${venue.code}`}
      aria-label={venue.title}
      sx={(th) => ({ display: 'block', textAlign: 'start', borderRadius: surfaceRadius.panel(th.palette.brand.radius), overflow: 'hidden', width: '100%', color: 'common.white' })}
    >
      <Box sx={{ position: 'relative', height: { xs: 168, md: 190 } }}>
        {venue.image ? (
          <KitImage src={venue.image} alt={venue.title} fill fallbackIcon={fallbackIconFor('product')} />
        ) : (
          <Box aria-hidden sx={(th) => ({ position: 'absolute', inset: 0, ...tileCoverFallbackSx(th) })} />
        )}
        <Box
          aria-hidden
          sx={{ position: 'absolute', inset: 0, background: tile.scrim }}
        />
        {statusText ? (
          <Box
            sx={(th) => ({
              position: 'absolute',
              top: 10,
              insetInlineEnd: 10,
              px: 1,
              py: 0.35,
              borderRadius: (theme) => surfaceRadius.pill(theme.palette.brand.radius),
              fontSize: 11,
              fontWeight: 700,
              bgcolor: alpha(th.palette.common.black, 0.42),
              backdropFilter: 'blur(8px)',
              border: `1px solid ${alpha(status?.state === 'open' ? th.palette.success.light : th.palette.common.white, 0.5)}`,
            })}
          >
            {statusText}
          </Box>
        ) : null}
        <Box sx={{ position: 'absolute', insetInline: 0, bottom: 0, pl: 2.25, pr: 2, pb: 1.5 }}>
          <Typography sx={(th) => ({ fontFamily: th.typography.h1.fontFamily, fontWeight: 800, fontSize: 20, lineHeight: 1.1, textShadow: tile.titleShadow })}>
            {venue.title}
          </Typography>
          {venue.subtitle ?? statusText ? (
            <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: onMedia.secondary }}>
              {venue.subtitle ?? statusText}
            </Typography>
          ) : null}
        </Box>
      </Box>
    </ButtonBase>
  );
}
