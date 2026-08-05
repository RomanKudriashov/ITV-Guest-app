import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { IconBack } from '@/icons';
import { layout, surfaceRadius } from '../storefrontTokens';
import { useStorefront } from '../useStorefront';
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
  const navigate = useNavigate();
  const { glass, scrim, onMedia, mediaFallback } = useStorefront();

  return (
    <Box
      data-testid="guest-venue-header"
      sx={{
        position: 'relative',
        height: { xs: layout.venueHeadPhone, md: layout.venueHeadWide },
        borderRadius: (theme) => ({ xs: 0, md: surfaceRadius.panel(theme.palette.brand.radius) }),
        overflow: 'hidden',
        mt: { xs: 0, md: 1 },
        backgroundImage: mediaFallback,
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

      {/*
        Выход из заведения. Ведёт на главную ЯВНО, а не через историю браузера:
        гость мог прийти сюда из другого заведения, из ссылки в чате или по
        прямому адресу, и «шаг назад» высадил бы его каждый раз в разном месте.
        Кнопка обещает витрину сервисов — и всегда её и открывает.

        Живёт в шапке, а значит есть на всех четырёх типах содержимого: шапку
        рисует `VenuePage` до выбора блока (каталог / заявка / слоты / инфо).
      */}
      <ButtonBase
        onClick={() => navigate('/home')}
        data-testid="guest-venue-back"
        aria-label={t('guest.venue.back')}
        sx={{
          position: 'absolute',
          insetInlineStart: { xs: 14, md: 26 },
          top: {
            xs: 'calc(14px + env(safe-area-inset-top, 0px))',
            md: 22,
          },
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          height: 36,
          px: 1.5,
          borderRadius: 999,
          fontSize: 12.5,
          fontWeight: 700,
          color: onMedia.primary,
          ...glass.chip,
          '&:hover': { bgcolor: onMedia.hover },
        }}
      >
        {/* Стрелка рисуется влево; в RTL «назад» — вправо, поэтому зеркалим. */}
        <Box
          sx={(th) => ({
            display: 'flex',
            transform: th.direction === 'rtl' ? 'scaleX(-1)' : 'none',
          })}
        >
          <IconBack size={16} />
        </Box>
        {t('guest.venue.back')}
      </ButtonBase>

      {/*
        Нижний отступ учитывает нахлёст панели контента: она подтянута вверх и
        накрывает низ кадра скруглением. Без этого запаса чип статуса уезжал
        под полосу категорий — наполовину видимый и нечитаемый.
      */}
      <Box
        sx={{
          position: 'absolute',
          left: { xs: 18, md: 34 },
          right: 18,
          bottom: { xs: 14 + layout.panelOverlap, md: 30 + layout.panelOverlap },
        }}
      >
        <Typography
          component="h1"
          sx={(th) => ({
            fontFamily: th.typography.h1.fontFamily,
            fontWeight: 800,
            letterSpacing: '-.03em',
            lineHeight: 1,
            color: onMedia.primary,
            fontSize: { xs: 27, md: 42 },
          })}
          data-testid="guest-venue-name"
        >
          {venue.title}
        </Typography>

        {venue.tagline ? (
          <Typography
            sx={{ color: onMedia.secondary, fontSize: { xs: 12, md: 14 }, mt: 0.75 }}
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
  const { glass, onMedia, openOnMedia } = useStorefront();
  return (
    <Box
      data-testid="guest-venue-status"
      sx={{
        fontSize: 10,
        fontWeight: 600,
        px: 1.25,
        py: 0.6,
        borderRadius: 999,
        color: open ? openOnMedia.color : onMedia.primary,
        ...glass.chip,
        borderColor: open ? openOnMedia.border : onMedia.chipBorder,
      }}
    >
      {label}
    </Box>
  );
}
