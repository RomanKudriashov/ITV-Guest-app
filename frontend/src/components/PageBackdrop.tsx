import Box from '@mui/material/Box';
import { alpha, useTheme } from '@mui/material/styles';

/**
 * ПОДЛОЖКА СТРАНИЦЫ ПОД СТЕКЛО (партия 56).
 *
 * Стеклу нужно, что размывать: на ровном цвете полупрозрачная панель выглядит
 * просто бледной. Мягкие пятна акцента и второго цвета темы поверх градиента
 * фона — из палитры, а не литералами: в бренде отеля подложка своя, в консоли —
 * платформенная. Слой фиксирован и лежит под всем содержимым оболочки.
 */
export function PageBackdrop() {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const { primary, secondary, background, brand } = theme.palette;
  return (
    <Box
      aria-hidden
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
        backgroundColor: background.default,
        backgroundImage: [
          `radial-gradient(1100px 620px at 8% -12%, ${alpha(primary.main, dark ? 0.26 : 0.2)}, transparent 62%)`,
          `radial-gradient(900px 560px at 104% 4%, ${alpha(secondary.main, dark ? 0.2 : 0.18)}, transparent 58%)`,
          `radial-gradient(900px 700px at 60% 118%, ${alpha(primary.main, dark ? 0.16 : 0.12)}, transparent 60%)`,
          `linear-gradient(180deg, ${background.default}, ${brand.surfaceMuted})`,
        ].join(', '),
      }}
    />
  );
}
