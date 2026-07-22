import Box from '@mui/material/Box';
import { alpha, type Theme } from '@mui/material/styles';

/**
 * Decorative, atmospheric backdrop for the staff sign-in screen.
 *
 * Purely CSS/SVG, built exclusively from theme tokens (`theme.palette.*` and
 * `theme.palette.brand.*`) — no color literals, no image assets. It layers:
 *   1. a soft radial haze wash (primarySoft + scrim),
 *   2. a large accent glow that breathes slowly,
 *   3. three pulsing concentric rings expanding from the centre,
 *   4. a few particles drifting upward,
 *   5. a readability scrim/vignette so card text keeps its contrast.
 *
 * Every moving part is silenced under `prefers-reduced-motion: reduce`, where
 * the final resting state is shown with no animation. The whole layer is
 * `aria-hidden` and non-interactive.
 */

// A handful of drifting particles. Positions use logical insets so the field
// mirrors correctly under RTL. Values are decorative, not directional.
const PARTICLES = [
  { inline: '18%', block: '72%', size: 6, delay: 0, duration: 15 },
  { inline: '34%', block: '86%', size: 4, delay: 4, duration: 19 },
  { inline: '52%', block: '78%', size: 8, delay: 2, duration: 17 },
  { inline: '68%', block: '88%', size: 5, delay: 6, duration: 21 },
  { inline: '82%', block: '70%', size: 6, delay: 1, duration: 16 },
  { inline: '44%', block: '64%', size: 3, delay: 8, duration: 23 },
] as const;

const RINGS = [
  { size: 220, delay: 0 },
  { size: 220, delay: 2.4 },
  { size: 220, delay: 4.8 },
] as const;

const cover = {
  position: 'absolute',
  inset: 0,
} as const;

export function AuthAtmosphere() {
  return (
    <Box
      aria-hidden
      sx={{
        ...cover,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      {/* 1 — soft haze wash */}
      <Box
        sx={(theme: Theme) => ({
          ...cover,
          background: [
            `radial-gradient(120% 90% at 50% -10%, ${theme.palette.brand.primarySoft}, transparent 60%)`,
            `radial-gradient(90% 70% at 15% 110%, ${alpha(theme.palette.primary.main, 0.1)}, transparent 55%)`,
            `radial-gradient(90% 70% at 85% 105%, ${alpha(theme.palette.secondary.main, 0.08)}, transparent 55%)`,
          ].join(','),
        })}
      />

      {/* 2 — breathing accent glow */}
      <Box
        sx={(theme: Theme) => ({
          position: 'absolute',
          insetInlineStart: '50%',
          insetBlockStart: '32%',
          width: 520,
          height: 520,
          marginInlineStart: -260,
          marginBlockStart: -260,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${alpha(theme.palette.primary.main, 0.28)}, transparent 65%)`,
          filter: 'blur(24px)',
          '@keyframes authGlowBreathe': {
            '0%, 100%': { transform: 'scale(0.92)', opacity: 0.55 },
            '50%': { transform: 'scale(1.08)', opacity: 0.85 },
          },
          animation: 'authGlowBreathe 9s ease-in-out infinite',
          '@media (prefers-reduced-motion: reduce)': {
            animation: 'none',
            transform: 'scale(1)',
            opacity: 0.7,
          },
        })}
      />

      {/* 3 — pulsing concentric rings */}
      <Box
        sx={{
          position: 'absolute',
          insetInlineStart: '50%',
          insetBlockStart: '38%',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {RINGS.map((ring, i) => (
          <Box
            key={i}
            sx={(theme: Theme) => ({
              gridArea: '1 / 1',
              width: ring.size,
              height: ring.size,
              borderRadius: '50%',
              border: `1px solid ${alpha(theme.palette.primary.main, 0.35)}`,
              transformOrigin: 'center',
              '@keyframes authRingPulse': {
                '0%': { transform: 'scale(0.75)', opacity: 0 },
                '35%': { opacity: 0.5 },
                '100%': { transform: 'scale(1.9)', opacity: 0 },
              },
              animation: `authRingPulse 7.2s ease-out ${ring.delay}s infinite`,
              '@media (prefers-reduced-motion: reduce)': {
                animation: 'none',
                // Only the innermost ring stays as a faint static halo.
                opacity: i === 0 ? 0.25 : 0,
                transform: 'scale(1)',
              },
            })}
          />
        ))}
      </Box>

      {/* 4 — drifting particles */}
      {PARTICLES.map((p, i) => (
        <Box
          key={i}
          sx={(theme: Theme) => ({
            position: 'absolute',
            insetInlineStart: p.inline,
            insetBlockStart: p.block,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            backgroundColor: alpha(theme.palette.primary.main, 0.55),
            boxShadow: theme.palette.brand.elevation.glow,
            '@keyframes authDrift': {
              '0%': { transform: 'translateY(0)', opacity: 0 },
              '15%': { opacity: 0.7 },
              '85%': { opacity: 0.7 },
              '100%': { transform: 'translateY(-60px)', opacity: 0 },
            },
            animation: `authDrift ${p.duration}s ease-in-out ${p.delay}s infinite`,
            '@media (prefers-reduced-motion: reduce)': {
              animation: 'none',
              transform: 'none',
              opacity: 0.35,
            },
          })}
        />
      ))}

      {/* 5 — readability scrim / vignette */}
      <Box
        sx={(theme: Theme) => ({
          ...cover,
          background: `radial-gradient(120% 100% at 50% 45%, transparent 45%, ${alpha(theme.palette.background.default, 0.65)} 100%)`,
        })}
      />
    </Box>
  );
}
