import { colorsForMode, type BrandTokens, type ThemeMode } from './tokens';
import { patternDataUri } from './brandPatterns';

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

/**
 * Turns the brand `background` token into concrete CSS for a backdrop layer.
 * Kept pure and framework-free so both the storefront and the CMS preview build
 * the same backdrop from the same tokens.
 */
export function resolveBackground(tokens: BrandTokens, mode: ThemeMode): ResolvedBackground {
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
    /*
      ПАТТЕРН РИСУЕТСЯ ЗДЕСЬ, А НЕ ПРИХОДИТ ИЗВНЕ.

      Раньше ссылку полагалось передать снаружи (`options.abstractionUrl`), и её
      не передавал НИКТО: оператор выбирал фактуру, сохранял, а гость видел
      ровный цвет. Четыре пресета из библиотеки идут именно с паттерном — то
      есть у отеля на таком пресете фон был пуст с самого начала.

      Цвет — текстовый: он по определению различим на своём фоне в обоих
      режимах, и фактура остаётся фактурой, а не грязью.
    */
    const url = patternDataUri(bg.abstraction, colors.text);
    return {
      css: {
        backgroundColor: colors.background,
        backgroundImage: url ? `url("${url}")` : undefined,
        // Фактура повторяется в СВОЁМ размере: `cover` растянул бы плитку на
        // весь экран, и вместо льна получилась бы пара огромных полос.
        backgroundSize: '120px 120px',
        backgroundRepeat: 'repeat',
      },
      dim: bg.dim ?? 0,
    };
  }

  return { css: { backgroundColor: colors.background }, dim: 0 };
}
