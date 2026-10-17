import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';

import { useAppTheme } from '@/theme';
import { resolveBackground } from '@/theme/brandBackground';
import { colorsForMode } from '@/theme/tokens';
import { useCoverBackground } from '@/kit/useCoverBackground';
import { PHOTO_EXTREMES, mixColors, pageVeilAlpha } from '../storefrontTokens';

/**
 * ФОН БРЕНДА ЗА ВСЕМИ ЭКРАНАМИ ГОСТЯ (партия 25, п.51 партии 24).
 *
 * Фон, который отель выбирает в оформлении, был виден только на входе:
 * дальше гость видел ровный цвет страницы, какой бы фон отель ни поставил.
 * Теперь фон — слоем под оболочкой, а над ним вуаль цветом страницы, плотность
 * которой считает `pageVeilAlpha` из контраста текста. Отель без фона
 * (ровный цвет страницы) получает вуаль 0 — то есть ровно то, что было.
 *
 * Оба слоя `fixed`: фон не уезжает с прокруткой и не растягивается по длине
 * меню, как растянулась бы картинка на всю высоту документа.
 */
/** Концы и 15 промежуточных цветов между ними. */
function between(from: string, to: string): string[] {
  return Array.from({ length: 17 }, (_, i) => mixColors(from, to, i / 16));
}

export function GuestBackdrop() {
  const { tokens, mode } = useAppTheme();
  const colors = colorsForMode(tokens, mode);
  const backdrop = resolveBackground(tokens, mode);
  const bg = tokens.brand?.background;
  // Фото фона объектом (партия 58а): ширина — по экрану, положение — по фокусу.
  const cover = useCoverBackground(bg?.kind === 'image' ? bg.imageRef : null);

  /*
    ЧТО МОЖЕТ ОКАЗАТЬСЯ ПОД ТЕКСТОМ — ВЕСЬ ДИАПАЗОН, А НЕ КОНЦЫ. Для текста
    средней яркости (вторичный серый) худший фон — не чёрный и не белый, а
    близкий к нему по яркости: он и лежит между концами градиента, на краях
    штриха фактуры, в любом месте фото. Замер это показал — 2,77 при 3.
  */
  const behind =
    bg?.kind === 'gradient' && bg.gradient
      ? between(bg.gradient.from, bg.gradient.to)
      : bg?.kind === 'image' && bg.imageUrl
        ? between(...PHOTO_EXTREMES)
        : bg?.kind === 'abstraction' && bg.abstraction
          ? between(colors.text, colors.background)
          : [backdrop.css.backgroundColor ?? colors.background];
  /*
    ЦВЕТА ТЕКСТА — ТЕ, КОТОРЫМИ ОН НАРИСОВАН (партия 56): тема доводит
    вторичный и третий уровень до 4.5 (theme/contrast.ts), и текст на экране
    уже не цвета токена бренда. Вуаль считалась по сырому `textSecondary` и
    без третьего уровня — подписи чата и пустых заказов давали 4.44 на фото.
  */
  const palette = useTheme().palette;
  const veil = pageVeilAlpha(
    colors.background,
    [palette.text.primary, palette.text.secondary, palette.brand.textTertiary],
    behind,
  );

  return (
    <>
      <Box
        aria-hidden
        data-testid="guest-backdrop"
        ref={cover.ref}
        sx={{
          position: 'fixed',
          inset: 0,
          zIndex: -1,
          pointerEvents: 'none',
          ...backdrop.css,
          ...(cover.sx ? { ...cover.sx, backgroundColor: backdrop.css.backgroundColor } : {}),
        }}
      />
      <Box
        aria-hidden
        data-testid="guest-backdrop-veil"
        data-veil={veil}
        sx={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none', bgcolor: colors.background, opacity: veil }}
      />
    </>
  );
}
