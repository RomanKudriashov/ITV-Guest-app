import Box from '@mui/material/Box';
import { alpha, type Theme } from '@mui/material/styles';

import { resolveBackground, useAppTheme } from '@/theme';

/**
 * Полотно входа — эталон `ITV-Guest-app-login-AC.html`, вариант A.
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
            backgroundColor: theme.palette.brand.scrim,
            opacity: dim,
          })}
        />
      ) : null}

      {/* скрим читаемости — десктоп `.a`, телефон `.m` */}
      <Box
        sx={(theme: Theme) => {
          const k = (a: number) => alpha(theme.palette.common.black, a);
          const horizontal = theme.direction === 'rtl' ? 270 : 90;
          return {
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(${horizontal}deg, ${k(0.9)} 0%, ${k(0.55)} 44%, ${k(
              0.15,
            )} 100%), linear-gradient(180deg, ${k(0.5)}, transparent 32%, ${k(0.7)})`,
            [theme.breakpoints.down('md')]: {
              background: `linear-gradient(180deg, ${k(0.55)} 0%, ${k(0.15)} 30%, ${k(0.92)} 78%)`,
            },
          };
        }}
      />
    </Box>
  );
}
