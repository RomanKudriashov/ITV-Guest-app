import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { alpha, type Theme } from '@mui/material/styles';

import { IconRestaurant, type AppIconComponent } from '@/icons';
import { fadeInSx } from './motion';

/**
 * The storefront's single image primitive.
 *
 * Every picture in the storefront goes through here so the four concerns live in
 * one place: it lazy-loads (`loading="lazy"`), shows a shimmer skeleton until the
 * bytes arrive, holds a fixed aspect ratio so nothing reflows, and — when there
 * is no image — paints a DESIGNED fallback: a monochrome section/type icon on a
 * textured token surface with depth, never a flat coloured circle. Colours come
 * only from theme tokens.
 */
export interface KitImageProps {
  src?: string | null;
  alt: string;
  /** CSS aspect-ratio (e.g. `'16 / 9'`). Ignored when `fill` is set. */
  ratio?: string;
  /** Fill a positioned parent (`position: absolute; inset: 0`) instead of owning a ratio box. */
  fill?: boolean;
  /** Icon drawn on the fallback surface — pick a section/type icon per item. */
  fallbackIcon?: AppIconComponent;
  /** Fallback icon size (px). */
  fallbackIconSize?: number;
  /** Corner radius (px). Defaults to no rounding (parent usually clips). */
  radius?: number;
  testId?: string;
}

/** Textured token surface used behind a missing image — soft gradient + depth. */
export function mediaFallbackSx(theme: Theme) {
  const soft = theme.palette.brand.primarySoft;
  const line = theme.palette.divider;
  return {
    backgroundColor: theme.palette.brand.surfaceMuted,
    backgroundImage: [
      `radial-gradient(130% 120% at 18% 12%, ${soft}, transparent 55%)`,
      `radial-gradient(120% 130% at 100% 100%, ${alpha(theme.palette.primary.main, 0.06)}, transparent 60%)`,
      `repeating-linear-gradient(135deg, ${alpha(line, 0.5)} 0 1px, transparent 1px 13px)`,
    ].join(','),
    boxShadow: `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.04)}, inset 0 0 40px -18px ${theme.palette.brand.scrim}`,
  } as const;
}

export function KitImage({
  src,
  alt,
  ratio = '16 / 9',
  fill = false,
  fallbackIcon: FallbackIcon = IconRestaurant,
  fallbackIconSize = 40,
  radius,
  testId,
}: KitImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  // A new source restarts the load/skeleton cycle.
  useEffect(() => {
    setLoaded(false);
    setErrored(false);
  }, [src]);

  const showImage = Boolean(src) && !errored;

  const frameSx = fill
    ? ({ position: 'absolute', inset: 0 } as const)
    : ({ position: 'relative', width: '100%', aspectRatio: ratio } as const);

  return (
    <Box
      data-testid={testId}
      sx={{
        ...frameSx,
        overflow: 'hidden',
        ...(radius != null ? { borderRadius: `${radius}px` } : {}),
      }}
    >
      {showImage ? (
        <>
          {/* Skeleton shimmer sits under the image until it decodes. */}
          {!loaded ? (
            <Box
              aria-hidden
              sx={(theme) => ({
                position: 'absolute',
                inset: 0,
                bgcolor: theme.palette.brand.surfaceMuted,
                '@keyframes kitPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.5 } },
                animation: 'kitPulse 1.4s ease-in-out infinite',
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              })}
            />
          ) : null}
          <Box
            component="img"
            src={src as string}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
            sx={[
              {
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: loaded ? 1 : 0,
              },
              loaded ? fadeInSx() : {},
            ]}
          />
        </>
      ) : (
        <Box
          aria-hidden
          sx={(theme) => ({
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: theme.palette.brand.textTertiary,
            ...mediaFallbackSx(theme),
          })}
        >
          <FallbackIcon size={fallbackIconSize} />
        </Box>
      )}
    </Box>
  );
}
