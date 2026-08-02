import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { layout } from '../storefrontTokens';
import { useStorefront } from '../useStorefront';

/**
 * Парадная отеля — первый кадр главной.
 *
 * До R5 главная начиналась с текстового приветствия: функционально верно и
 * совершенно безлико. Отель продаёт впечатление, и первое, что видит гость,
 * должно быть его кадром, а не заголовком.
 *
 * Обложка приходит из «Бренд и витрина» (R4). Её нет — остаётся фирменный
 * градиент: пустой серый прямоугольник читался бы как незагрузившееся фото.
 */
export function HomeHero({
  hotelName,
  greeting,
  cover,
}: {
  hotelName: string;
  greeting: string;
  cover: string | null;
}) {
  const { scrim, onMedia, mediaFallback } = useStorefront();

  return (
    <Box
      data-testid="guest-home-hero"
      sx={{
        position: 'relative',
        height: { xs: layout.heroPhone, md: layout.heroWide },
        borderRadius: { xs: 0, md: '20px' },
        overflow: 'hidden',
        mt: { xs: 0, md: 1 },
        backgroundImage: mediaFallback,
      }}
    >
      {cover ? (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url(${cover})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      ) : null}

      {/* Скрим: белый текст поверх произвольного кадра иначе нечитаем. */}
      <Box aria-hidden sx={{ position: 'absolute', inset: 0, background: scrim.hero }} />


      <Box
        sx={{
          position: 'absolute',
          left: { xs: 18, md: 34 },
          right: 18,
          bottom: { xs: 16, md: 28 },
        }}
      >
        <Typography
          component="h1"
          sx={(th) => ({
            fontFamily: th.typography.h1.fontFamily,
            fontWeight: 800,
            letterSpacing: '-.03em',
            lineHeight: 1.02,
            color: onMedia.primary,
            fontSize: { xs: 33, md: 46 },
          })}
        >
          {greeting}
        </Typography>
        <Typography sx={{ color: onMedia.secondary, fontSize: 13, mt: 0.9 }}>
          {hotelName}
        </Typography>
      </Box>
    </Box>
  );
}
