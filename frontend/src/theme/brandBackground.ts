import { colorsForMode, type BrandTokens, type ThemeMode } from './tokens';

export interface ResolvedBackground {
  /** CSS applied to the backdrop layer. */
  css: {
    backgroundColor?: string;
    backgroundImage?: string;
    backgroundSize?: string;
    backgroundPosition?: string;
    backgroundRepeat?: string;
  };
  /**
   * Opacity of the dimming layer (0..1). The layer itself is painted with the
   * palette `scrim` token, so no raw color leaks outside `tokens.ts`.
   */
  dim: number;
}

export interface ResolveBackgroundOptions {
  /** Maps an abstraction code to the preview URL served by the brand library. */
  abstractionUrl?: (code: string) => string | undefined;
}

/**
 * Turns the brand `background` token into concrete CSS for a backdrop layer.
 * Kept pure and framework-free so both the storefront and the CMS preview build
 * the same backdrop from the same tokens.
 */
export function resolveBackground(
  tokens: BrandTokens,
  mode: ThemeMode,
  options: ResolveBackgroundOptions = {},
): ResolvedBackground {
  const colors = colorsForMode(tokens, mode);
  const bg = tokens.brand?.background;

  if (!bg || bg.kind === 'solid') {
    return { css: { backgroundColor: bg?.color || colors.background }, dim: 0 };
  }

  if (bg.kind === 'gradient' && bg.gradient) {
    const { from, to, angle } = bg.gradient;
    return {
      css: { backgroundImage: `linear-gradient(${angle}deg, ${from}, ${to})` },
      dim: 0,
    };
  }

  if (bg.kind === 'image' && bg.imageUrl) {
    return {
      css: {
        backgroundColor: colors.background,
        backgroundImage: `url(${bg.imageUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      },
      dim: bg.dim ?? 0,
    };
  }

  if (bg.kind === 'abstraction' && bg.abstraction) {
    const url = options.abstractionUrl?.(bg.abstraction);
    return {
      css: {
        backgroundColor: colors.background,
        backgroundImage: url ? `url(${url})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'repeat',
      },
      dim: bg.dim ?? 0,
    };
  }

  return { css: { backgroundColor: colors.background }, dim: 0 };
}
