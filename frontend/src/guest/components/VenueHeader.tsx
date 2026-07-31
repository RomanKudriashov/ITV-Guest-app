import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { glass, layout, scrim } from '../storefrontTokens';
import type { VenueIdentity } from '../api/types';

/**
 * Шапка заведения — то, ради чего затевалось проваливание.
 *
 * До R5 гость тапал по «Панораме» и попадал в меню, озаглавленное именем
 * ОТЕЛЯ: заведение как таковое исчезало, и «меню без ресторана» было ровно тем,
 * что карта продукта называла главной поломкой. Здесь кадр, имя и подпись
 * принадлежат заведению.
 *
 * Скрим разный по ширине: на телефоне текст внизу, на десктопе — слева, и
 * затемнение обязано идти оттуда же, иначе оно гасит не ту часть кадра.
 */
export function VenueHeader({ venue }: { venue: VenueIdentity }) {
  const { t } = useTranslation();

  return (
    <Box
      data-testid="guest-venue-header"
      sx={{
        position: 'relative',
        height: { xs: layout.venueHeadPhone, md: layout.venueHeadWide },
        borderRadius: { xs: 0, md: '20px' },
        overflow: 'hidden',
        mt: { xs: 0, md: 1 },
        backgroundImage: 'linear-gradient(150deg,#1c2b43,#0b1220)',
      }}
    >
      {venue.image ? (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url(${venue.image})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      ) : null}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          background: { xs: scrim.hero, md: scrim.heroWide },
        }}
      />

      <Box
        sx={{
          position: 'absolute',
          left: { xs: 18, md: 34 },
          right: 18,
          bottom: { xs: 14, md: 30 },
        }}
      >
        <Typography
          component="h1"
          sx={(th) => ({
            fontFamily: th.typography.h1.fontFamily,
            fontWeight: 800,
            letterSpacing: '-.03em',
            lineHeight: 1,
            color: '#fff',
            fontSize: { xs: 27, md: 42 },
          })}
          data-testid="guest-venue-name"
        >
          {venue.title}
        </Typography>

        {venue.tagline ? (
          <Typography
            sx={{ color: 'rgba(255,255,255,.74)', fontSize: { xs: 12, md: 14 }, mt: 0.75 }}
          >
            {venue.tagline}
          </Typography>
        ) : null}

        <Box sx={{ display: 'flex', gap: 0.9, mt: 1.5, flexWrap: 'wrap' }}>
          {/*
            Статус часов — первое, что гость хочет знать о заведении: заказать
            он сможет только пока оно открыто.
          */}
          <Chip
            open={venue.is_open}
            label={
              venue.is_open
                ? venue.available_until
                  ? t('guest.venue.openUntil', { time: venue.available_until })
                  : t('guest.venue.open')
                : venue.available_from
                  ? t('guest.venue.opensAt', { time: venue.available_from })
                  : t('guest.venue.closed')
            }
          />
        </Box>
      </Box>
    </Box>
  );
}

function Chip({ label, open }: { label: string; open: boolean }) {
  return (
    <Box
      data-testid="guest-venue-status"
      sx={{
        fontSize: 10,
        fontWeight: 600,
        px: 1.25,
        py: 0.6,
        borderRadius: 999,
        color: open ? '#9BE7A6' : '#fff',
        ...glass.chip,
        borderColor: open ? 'rgba(121,212,136,.5)' : 'rgba(255,255,255,.18)',
      }}
    >
      {label}
    </Box>
  );
}
