import Box from '@mui/material/Box';
import { alpha, useTheme, type Theme } from '@mui/material/styles';

import { resolveBackground, useAppTheme } from '@/theme';
import { photoPlate, photoPlateSx } from '@/theme/contrast';

/**
 * Полотно входа — по дизайн-эталону `docs/design/login-ac.html`.
 *
 * Кадр отеля во всю ширину с медленным приближением (ken-burns, scale 1→1.09 за
 * 28s) и читаемым скримом поверх: на десктопе — тёмный слева→направо + сверху/
 * снизу, на телефоне — вертикальный. Фото берётся из бренд-подложки отеля; если
 * её нет — токен-градиент (реального фото офлайн нет, это заглушка под съёмку).
 * Слой декоративный (`aria-hidden`), движение гаснет при
 * `prefers-reduced-motion`. Цвета — только из токенов; скрим из common.black,
 * т.к. лежит над фото с белым текстом в любой теме.
 */
export function AuthAtmosphere() {
  const { tokens, mode } = useAppTheme();
  const resolved = resolveBackground(tokens, mode);
  const bg = tokens.brand?.background;
  const hasPhoto = bg?.kind === 'image' && Boolean(bg.imageUrl);
  const dim = hasPhoto ? resolved.dim : 0;

  return (
    <Box
      aria-hidden
      sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}
    >
      {/* кадр (или токен-градиент) — ken-burns */}
      <Box
        sx={(theme: Theme) => ({
          position: 'absolute',
          inset: '-4%',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          ...(hasPhoto
            ? { backgroundImage: resolved.css.backgroundImage }
            : {
                backgroundImage: `linear-gradient(150deg, ${alpha(
                  theme.palette.primary.main,
                  0.85,
                )} 0%, ${theme.palette.common.black} 70%)`,
              }),
          '@keyframes authKen': {
            from: { transform: 'scale(1)' },
            to: { transform: 'scale(1.09)' },
          },
          animation: 'authKen 28s ease-in-out infinite alternate',
          '@media (prefers-reduced-motion: reduce)': { animation: 'none', transform: 'none' },
        })}
      />

      {dim > 0 ? (
        <Box
          sx={(theme: Theme) => ({
            position: 'absolute',
            inset: 0,
            // Слайдер «Затемнение» — тем же чёрным, что на входе гостя, в
            // шапке каталога и над фоном витрины (партия 58б).
            backgroundColor: theme.palette.common.black,
            opacity: dim,
          })}
        />
      ) : null}

      {/*
        Скрима читаемости на весь кадр нет (партия 58б): он затемнял и правую
        часть, где текста нет. Над фото — только слайдер «Затемнение» (выше),
        текст держит подложка под маркой и формой (`useAuthPlateSx`).
      */}
    </Box>
  );
}

/**
 * Подложка под маркой и формой входа (партия 58б) — только когда за ними фото
 * бренда: белый текст держит 4,5 на любом кадре. Без фото (градиент токенов)
 * подложки нет — фон и так тёмный и ровный.
 */
export function useAuthPlateSx(spread = 40) {
  const { tokens } = useAppTheme();
  const { common } = useTheme().palette;
  const bg = tokens.brand?.background;
  if (!(bg?.kind === 'image' && bg.imageUrl)) return {};
  // Белые буквы и подпись (белый 72 %) по кадру — как в форме входа.
  return photoPlateSx(photoPlate(common.black, [common.white, alpha(common.white, 0.72)]), spread);
}
