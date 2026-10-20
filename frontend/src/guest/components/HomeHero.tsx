import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { ImageRef } from '@/kit/imageRef';
import { useCoverBackground } from '@/kit/useCoverBackground';

import { fontPx, layout, surfaceRadius, type StorefrontTokens } from '../storefrontTokens';
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
  coverRef,
}: {
  hotelName: string;
  greeting: string;
  cover: string | null;
  /** Объект обложки (партия 58а) — есть, фон берётся по ширине места. */
  coverRef?: ImageRef | null;
}) {
  return (
    <HomeHeroView hotelName={hotelName} greeting={greeting} cover={cover} coverRef={coverRef} tokens={useStorefront()} />
  );
}

/**
 * Та же парадная, но БЕЗ контекста темы — токены приходят параметром.
 *
 * Нужна показу бренда в CMS: там своя тема превью, и `useStorefront()` вернул
 * бы режим окружающей админки, а не тот, что выбран в показе. Приём в проекте
 * уже принят — `CatalogRowView`, `ItemHeadlineView`.
 *
 * Ради этого и разделено: показ обязан рисовать первый экран ТЕМ ЖЕ кодом, что
 * и витрина. Вторая реализация «как у гостя» разошлась бы с гостем молча — и
 * тогда показ обещал бы одно, а гость видел другое.
 */
export function HomeHeroView({
  hotelName,
  greeting,
  cover,
  coverRef,
  tokens,
}: {
  hotelName: string;
  greeting: string;
  cover: string | null;
  coverRef?: ImageRef | null;
  tokens: StorefrontTokens;
}) {
  const { scrim, onMedia, mediaFallback } = tokens;
  // Обложка главной — кадр фона бренда (`cover_image_ref`), поэтому ширина от
  // окна, как у фона страницы: один файл на экран, а не 1200 и 2400 одного
  // кадра (партия 61-хвост).
  const bg = useCoverBackground(coverRef, { viewport: true });

  return (
    <Box
      data-testid="guest-home-hero"
      sx={{
        position: 'relative',
        height: { xs: layout.heroPhone, md: 'auto' },
        // Предел формы 3:1 (партия 58б): 1080×304 было 3,55:1.
        minHeight: { md: layout.heroWide },
        aspectRatio: { md: `${layout.maxHeroRatio} / 1` },
        borderRadius: (theme) => ({ xs: 0, md: surfaceRadius.panel(theme.palette.brand.radius) }),
        overflow: 'hidden',
        mt: { xs: 0, md: 1 },
        backgroundImage: mediaFallback,
      }}
    >
      {bg.sx || cover ? (
        <Box
          aria-hidden
          ref={bg.ref}
          data-testid="guest-home-hero-cover"
          sx={{
            position: 'absolute',
            inset: 0,
            ...(bg.sx ?? { backgroundImage: `url(${cover})`, backgroundPosition: 'center' }),
            backgroundSize: 'cover',
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
            fontWeight: th.typography.h1.fontWeight,
            letterSpacing: '-.03em',
            lineHeight: 1.02,
            color: onMedia.primary,
            fontSize: { xs: fontPx(33, 'heading'), md: fontPx(46, 'heading') },
          })}
        >
          {greeting}
        </Typography>
        <Typography sx={{ color: onMedia.secondary, fontSize: fontPx(13), mt: 0.9 }}>
          {hotelName}
        </Typography>
      </Box>
    </Box>
  );
}
