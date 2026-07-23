import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import type { Theme } from '@mui/material/styles';

import { KitImage } from '@/kit';
import { fallbackIconFor } from './typeFallbackIcon';
import { packBento, type Placed } from './bentoPack';
import type { GuestShowcaseTile, GuestVenueStatus } from '../api/types';

/**
 * Cover fallback for a tile without a photo. ALWAYS dark (with a brand-tinted
 * glow), independent of the light/dark theme — the tile text is white in either
 * mode, so a light fallback would break contrast. This is the last step of the
 * cover cascade: point photo → category photo → this gradient.
 */
export function tileCoverFallbackSx(theme: Theme) {
  return {
    backgroundColor: '#0a0f18',
    backgroundImage: [
      `radial-gradient(120% 100% at 18% 0%, ${alpha(theme.palette.primary.main, 0.4)}, transparent 58%)`,
      'linear-gradient(160deg, #16233b 0%, #080c14 92%)',
    ].join(','),
  } as const;
}

/** Localised status-pill text, or null when the venue has no schedule. */
function useStatusLabel() {
  const { t } = useTranslation();
  return (status: GuestVenueStatus | null): { text: string; open: boolean } | null => {
    if (!status) return null;
    if (status.state === 'open') {
      return {
        open: true,
        text: status.until ? t('guest.venue.until', { time: status.until }) : t('guest.venue.open'),
      };
    }
    return {
      open: false,
      text: status.opens_at ? t('guest.venue.opensAt', { time: status.opens_at }) : t('guest.venue.closed'),
    };
  };
}

function StatusPill({ status }: { status: { text: string; open: boolean } }) {
  return (
    <Box
      sx={(th) => ({
        alignSelf: 'flex-start',
        px: 1,
        py: 0.35,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.4,
        color: 'common.white',
        bgcolor: alpha(th.palette.common.black, 0.42),
        backdropFilter: 'blur(8px)',
        border: `1px solid ${alpha(status.open ? th.palette.success.light : th.palette.common.white, 0.5)}`,
        whiteSpace: 'nowrap',
      })}
    >
      {status.text}
    </Box>
  );
}

interface BentoTileProps {
  tile: GuestShowcaseTile;
  /** Narrow footprint (1 column) — hide the meta line, keep only the title. */
  compact: boolean;
  onOpen: (route: string) => void;
}

/**
 * One bento tile — reference login-canvas style: a full-bleed cover, a bottom-only
 * scrim, the title + meta in the lower-left, and a status pill in the upper-right.
 * The centre stays clear. A disabled tile (room-control stub) reads as "coming".
 */
export function BentoTile({ tile, compact, onOpen }: BentoTileProps) {
  const { t } = useTranslation();
  const statusLabel = useStatusLabel();
  const status = statusLabel(tile.status);
  const disabled = !tile.enabled || !tile.route;

  const previews = tile.cover_previews ?? [];
  const collage = tile.type === 'service-category' && previews.length > 1;

  const meta =
    tile.type === 'service-category' && tile.venue_count != null
      ? t('guest.home.venueCount', { count: tile.venue_count })
      : tile.subtitle ?? null;

  return (
    <ButtonBase
      focusRipple
      disabled={disabled}
      data-testid={`guest-home-tile-${tile.key}`}
      data-tile-type={tile.type}
      aria-label={tile.title}
      onClick={() => tile.route && onOpen(tile.route)}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 132,
        borderRadius: 4,
        overflow: 'hidden',
        display: 'block',
        textAlign: 'start',
        color: 'common.white',
        '&.Mui-disabled': { opacity: 1 },
      }}
    >
      {/* Cover: single photo, a collage of previews, or a brand-gradient fallback. */}
      {collage ? (
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }}>
          {previews.slice(0, 4).map((src, i) => (
            <Box key={i} sx={{ position: 'relative', overflow: 'hidden' }}>
              <KitImage src={src} alt="" fill fallbackIcon={fallbackIconFor('product')} />
            </Box>
          ))}
        </Box>
      ) : tile.image ? (
        <KitImage src={tile.image} alt={tile.title} fill fallbackIcon={fallbackIconFor('product')} />
      ) : (
        <Box aria-hidden sx={(th) => ({ position: 'absolute', inset: 0, ...tileCoverFallbackSx(th) })} />
      )}

      {/* Bottom-only scrim so the lower-left text reads; the centre stays clear. */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(to top, ${alpha('#05070c', 0.82)} 0%, ${alpha('#05070c', 0.5)} 22%, transparent 46%)`,
        }}
      />
      {disabled ? (
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, bgcolor: alpha('#05070c', 0.35) }} />
      ) : null}

      {/* Status / "coming" pill, upper-right. */}
      <Box sx={{ position: 'absolute', top: 10, right: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        {disabled ? (
          <StatusPill status={{ text: t('guest.home.comingSoon'), open: false }} />
        ) : status ? (
          <StatusPill status={status} />
        ) : null}
      </Box>

      {/* Title + meta, lower-left. Left inset clears the corner radius so the
          first glyph is never clipped by the rounded corner. */}
      <Box sx={{ position: 'absolute', insetInline: 0, bottom: 0, pl: 2.25, pr: 2, pb: 1.75, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <Typography
          sx={(th) => ({
            fontFamily: th.typography.h1.fontFamily,
            fontWeight: 800,
            letterSpacing: '-0.01em',
            fontSize: compact ? 16 : 20,
            lineHeight: 1.1,
            textShadow: '0 2px 14px rgba(0,0,0,0.6)',
          })}
        >
          {tile.title}
        </Typography>
        {!compact && meta ? (
          <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: alpha('#fff', 0.82), textShadow: '0 1px 8px rgba(0,0,0,0.55)' }}>
            {meta}
          </Typography>
        ) : null}
      </Box>
    </ButtonBase>
  );
}

export interface BentoGridProps {
  tiles: GuestShowcaseTile[];
  /** Columns: 2 on mobile, 4 on desktop. */
  columns: number;
  onOpen: (route: string) => void;
}

/**
 * The bento showcase — packs tiles with {@link packBento} so there are never
 * holes or orphan tiles, and renders each at its computed column/row span.
 */
export function BentoGrid({ tiles, columns, onOpen }: BentoGridProps) {
  const placed: Placed<GuestShowcaseTile>[] = packBento(tiles, columns);
  return (
    <Box
      data-testid="guest-home-bento"
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gridAutoRows: { xs: 128, md: 150 },
        gap: { xs: 1.25, md: 1.75 },
      }}
    >
      {placed.map((p) => (
        <Box
          key={p.tile.key}
          sx={{
            gridColumn: `${p.colStart} / span ${p.colSpan}`,
            gridRow: `${p.rowStart} / span ${p.rowSpan}`,
          }}
        >
          <BentoTile tile={p.tile} compact={p.colSpan === 1} onOpen={onOpen} />
        </Box>
      ))}
    </Box>
  );
}
