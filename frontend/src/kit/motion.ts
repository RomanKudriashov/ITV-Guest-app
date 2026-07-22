/**
 * Redesign-v2 motion helper — the ONE place reduced-motion is honored.
 *
 * Motion here aids orientation (a screen mounts, a card arrives, a control
 * responds to a press), it never decorates. Every helper returns an `sx` object
 * that already carries its own `@media (prefers-reduced-motion: reduce)` escape
 * hatch, so a component never has to remember to add one: use a helper and the
 * reduced-motion contract is satisfied. The `usePrefersReducedMotion` hook is
 * for the few JS-driven cases (e.g. a Drawer's transition duration) where CSS
 * alone cannot express the intent.
 */
import { useMemo } from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';

/** Motion tokens — durations (ms) and easings, shared across the storefront. */
export const MOTION = {
  duration: { fast: 140, base: 240, slow: 360 },
  easing: {
    /** Standard ease-out for entrances. */
    entrance: 'cubic-bezier(0.22, 1, 0.36, 1)',
    /** Gentle spring-ish ease for sheets — a little inertia. */
    sheet: 'cubic-bezier(0.16, 1, 0.3, 1)',
  },
} as const;

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

/** True when the viewer asked the OS to reduce motion. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(REDUCE_QUERY, { noSsr: true });
}

/**
 * Transition duration for a sheet/drawer, collapsed to 0 when the viewer prefers
 * reduced motion so the open/close is instant rather than animated.
 */
export function useSheetTransition(): { enter: number; exit: number } {
  const reduce = usePrefersReducedMotion();
  return useMemo(
    () =>
      reduce
        ? { enter: 0, exit: 0 }
        : { enter: MOTION.duration.slow, exit: MOTION.duration.base },
    [reduce],
  );
}

export interface RevealOptions {
  /** Position in a list — drives the stagger delay. */
  index?: number;
  /** Per-item stagger step (ms). */
  step?: number;
  /** Vertical offset (px) the item rises from. */
  distance?: number;
  /** Cap the stagger so a long list never waits too long. */
  maxDelay?: number;
}

/**
 * Gentle mount reveal — a fade with a small upward drift, optionally staggered
 * by `index`. Under reduced motion the element simply appears (no transform, no
 * animation). Attach to any card/tile/section that mounts with content.
 */
export function revealSx({
  index = 0,
  step = 55,
  distance = 12,
  maxDelay = 420,
}: RevealOptions = {}): SystemStyleObject<Theme> {
  const delay = Math.min(index * step, maxDelay);
  return {
    '@keyframes kitReveal': {
      from: { opacity: 0, transform: `translateY(${distance}px)` },
      to: { opacity: 1, transform: 'translateY(0)' },
    },
    opacity: 0,
    animation: `kitReveal ${MOTION.duration.base}ms ${MOTION.easing.entrance} ${delay}ms both`,
    '@media (prefers-reduced-motion: reduce)': {
      animation: 'none',
      opacity: 1,
      transform: 'none',
    },
  };
}

/**
 * Press feedback for an interactive surface (tile, card, stepper). A subtle
 * scale-down on `:active` plus an eased transition; disabled under reduced
 * motion. Compose into a component's `sx` array.
 */
export const pressableSx: SystemStyleObject<Theme> = {
  transition: `transform ${MOTION.duration.fast}ms ${MOTION.easing.entrance}`,
  '&:active': { transform: 'scale(0.97)' },
  '@media (prefers-reduced-motion: reduce)': {
    transition: 'none',
    '&:active': { transform: 'none' },
  },
};

/**
 * A cross-fade for swapping skeleton → content (or any two states). The incoming
 * node fades in; instant under reduced motion.
 */
export function fadeInSx(duration = MOTION.duration.base): SystemStyleObject<Theme> {
  return {
    '@keyframes kitFadeIn': { from: { opacity: 0 }, to: { opacity: 1 } },
    animation: `kitFadeIn ${duration}ms ${MOTION.easing.entrance} both`,
    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
  };
}
